import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

const execFile = promisify(_execFile);

export async function ensureGitHubRepo({ repoName }) {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  if (!token || !owner) throw new Error('GITHUB_TOKEN and GITHUB_OWNER are required');

  // Try create
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json'
    },
    body: JSON.stringify({ name: repoName, private: false })
  });
  if (res.status === 422) {
    // Exists; fetch
    const info = await (await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
      headers: { 'Authorization': `token ${token}` }
    })).json();
    return info;
  }
  if (!res.ok) throw new Error(`GitHub repo create failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

export async function initAndPushGit({ remoteUrl }) {
  // Initialize if not a repo
  const isRepo = fs.existsSync('.git');
  if (!isRepo) {
    await execFile('git', ['init']);
  }
  await execFile('git', ['add', '-A']);
  try {
    await execFile('git', ['commit', '-m', 'chore: initial generated site']);
  } catch {}
  // Set remote
  try {
    await execFile('git', ['remote', 'remove', 'origin']);
  } catch {}
  await execFile('git', ['remote', 'add', 'origin', remoteUrl]);
  await execFile('git', ['branch', '-M', 'main']);
  await execFile('git', ['push', '-u', 'origin', 'main']);
}


