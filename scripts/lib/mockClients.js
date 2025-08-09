import sharp from 'sharp';

export class MockOpenAIClient {
  constructor() {}
  async generateSitePlan(niche, { clustersTarget = 5 } = {}) {
    const clusters = [];
    for (let i = 0; i < clustersTarget; i++) {
      clusters.push({
        cluster: `${niche} Cluster ${i + 1}`,
        keywords: Array.from({ length: 5 }, (_, k) => `${niche} topic ${i + 1}.${k + 1}`)
      });
    }
    return clusters;
  }
  async generateOutline({ keyword }) {
    return {
      sections: Array.from({ length: 6 }, (_, i) => ({
        title: `${keyword} Section ${i + 1}`,
        points: [
          'Key point A with actionable detail.',
          'Key point B with nuance.',
          'Key point C with example.'
        ],
        suggestImage: i % 2 === 1
      }))
    };
  }
  async generateContentPart({ keyword, partIndex }) {
    return `This is mock content part ${partIndex} for ${keyword}.\n\n` +
      Array.from({ length: 8 }, (_, i) => `Paragraph ${i + 1}: Insightful guidance for ${keyword}.`).join('\n\n');
  }
  async generateMetaDescription({ title }) {
    return `${title} — a concise, helpful guide with practical tips.`.slice(0, 158);
  }
}

export class MockReplicateClient {
  constructor() {}
  async generateAndSaveWebp({ outputPath }) {
    const image = sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 220, g: 220, b: 220 } } });
    await image.webp({ quality: 70 }).toFile(outputPath);
    return outputPath;
  }
}


