import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export class ReplicateClient {
  constructor({ apiToken, model }) {
    if (!apiToken) throw new Error('REPLICATE_API_TOKEN is required');
    this.apiToken = apiToken;
    this.model = model || 'black-forest-labs/flux-dev';
  }

  async generateAndSaveWebp({ prompt, outputPath }) {
    const imageUrl = await this._runPrediction({ prompt });
    const buf = await fetchBuffer(imageUrl);
    await sharp(buf).webp({ quality: 82 }).toFile(outputPath);
    return outputPath;
  }

  async _runPrediction({ prompt }) {
    const versionId = await this._resolveVersionId(this.model);
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: versionId,
        input: { prompt }
      })
    });
    if (!response.ok) throw new Error(`Replicate start failed: ${response.status} ${await response.text()}`);
    let data = await response.json();
    const id = data.id;

    // Poll
    let status = data.status;
    let output;
    for (;;) {
      if (status === 'succeeded') {
        output = data.output;
        break;
      }
      if (status === 'failed' || status === 'canceled') {
        throw new Error(`Replicate failed: ${status}`);
      }
      await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
        headers: { 'Authorization': `Token ${this.apiToken}` }
      });
      data = await res.json();
      status = data.status;
    }

    const first = Array.isArray(data.output) ? data.output[0] : data.output;
    if (!first || typeof first !== 'string') throw new Error('Replicate returned no image URL');
    return first;
  }

  async _resolveVersionId(model) {
    // If model looks like a version id (UUID-like), just return it
    if (model && model.split('-').length > 4) return model;
    // Otherwise, resolve latest version for owner/name
    const [owner, name] = String(model || '').split('/');
    if (!owner || !name) throw new Error('Invalid REPLICATE_MODEL; expected owner/name or version id');
    const url = `https://api.replicate.com/v1/models/${owner}/${name}`;
    const res = await fetch(url, { headers: { 'Authorization': `Token ${this.apiToken}` } });
    if (!res.ok) throw new Error(`Replicate model lookup failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    const versionId = json?.latest_version?.id || json?.versions?.[0]?.id;
    if (!versionId) throw new Error('Could not resolve Replicate model version');
    return versionId;
  }
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}


