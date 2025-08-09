import OpenAI from 'openai';
import { sleep } from './fileUtils.js';

export class OpenAIClient {
  constructor({ apiKey, model, concurrency = 3 }) {
    if (!apiKey) throw new Error('OPENAI_API_KEY is required');
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.semaphore = new Semaphore(concurrency);
  }

  async generateBrand(niche) {
    const prompt = [
      `You are a brand strategist. Create a trustworthy blog brand for the niche: "${niche}".`,
      `Return ONLY JSON: { name: string, tagline: string, tone: string, valueProps: string[] }`,
      `- name: short and memorable`,
      `- tagline: 6-10 words, benefit-oriented`,
      `- tone: 2-4 words (e.g., Practical, Friendly, Expert)`,
      `- valueProps: 4 concise bullets (phrases)`
    ].join('\n');
    const json = await this._completeJson(prompt, 1024);
    return {
      name: String(json?.name || `${niche} Hub`).trim(),
      tagline: String(json?.tagline || `Expert insights on ${niche}`).trim(),
      tone: String(json?.tone || 'Helpful, Expert').trim(),
      valueProps: Array.isArray(json?.valueProps) ? json.valueProps.slice(0, 4) : []
    };
  }

  async generateStaticPages({ niche, brand }) {
    const base = (instruction) => [
      `${instruction}\nNiche: ${niche}\nBrand: ${brand.name} — ${brand.tagline}\nTone: ${brand.tone}.`,
      `Use markdown. Headings (H1 once, then H2/H3). Keep it concise and trustworthy.`
    ].join('\n');

    const heroPrompt = `Write homepage hero copy: H1 (<=70 chars, keyword-friendly), subtitle (<=140 chars), ctaText (<=18 chars). Return ONLY JSON { title, subtitle, ctaText }.`;
    const hero = await this._completeJson([base('Homepage hero copy.'), heroPrompt].join('\n'), 1024);

    const about = await this._completeText(base('Write About page that builds trust: who we are, editorial process, expert review, contact and how we source images. 400-600 words.'), 4096);
    const contact = await this._completeText(base('Write Contact page: short intro, email placeholder, typical response time, partnership note. 150-250 words.'), 2048);
    const privacy = await this._completeText(base('Write Privacy Policy: data we collect, cookies, analytics, ads, contact for removal. 600-900 words. Non-legalese, clear.'), 8192);
    const terms = await this._completeText(base('Write Terms of Service: acceptable use, IP, disclaimers, limitation of liability, changes. 600-900 words.'), 8192);

    return {
      hero: {
        title: toTitleCase(String(hero?.title || `${brand.name}: ${brand.tagline}`)),
        subtitle: String(hero?.subtitle || `Guides and insights on ${niche}`).trim(),
        ctaText: String(hero?.ctaText || 'Explore Guides').trim()
      },
      about,
      contact,
      privacy,
      terms
    };
  }

  async generateSitePlan(niche, { clustersTarget = 450, subtopicsPerCluster = [8, 12], siteTitle, siteTagline } = {}) {
    const min = subtopicsPerCluster[0];
    const max = subtopicsPerCluster[1];
    const prompt = [
      `You are an SEO strategist. Create ${clustersTarget} keyword clusters for niche: "${niche}".`,
      `Each cluster must have ${min}-${max} highly specific, non-overlapping blog post keywords (long-tail).`,
      `Return ONLY valid JSON array with objects: { "cluster": string, "keywords": string[] }.`
    ].join(' ');

    const content = await this._completeJson(prompt, 32768);
    if (!Array.isArray(content)) throw new Error('Invalid plan JSON');
    return content;
  }

  async generateSeoData({ niche, keyword }) {
    const prompt = [
      `Generate SEO data for a blog post targeting the exact keyword: "${keyword}" in the niche "${niche}".`,
      `Constraints:`,
      `- title: 60-70 chars, must contain the target keyword naturally, compelling and specific`,
      `- description: 150-160 chars, persuasive and informative`,
      `- lsi: 6-12 closely related LSI keywords/phrases (array of strings)`,
      `Return ONLY JSON: { title: string, description: string, lsi: string[] }`
    ].join('\n');
    const json = await this._completeJson(prompt, 1024);
    const title = toTitleCase(String(json?.title || keyword).trim());
    const description = String(json?.description || '').trim().slice(0, 160);
    const lsi = Array.isArray(json?.lsi) ? json.lsi.slice(0, 12) : [];
    return { title, description, lsi };
  }

  async generateOutline({ niche, keyword }) {
    const prompt = [
      `Create a detailed H2/H3 outline for a ~2000-word blog post on: "${keyword}" within the niche "${niche}".`,
      `Include 6-8 H2 sections with 2-5 bullet points each.`,
      `Suggest placing images after 2-3 of the H2 sections and for each suggested image include a short imagePrompt and alt text.`,
      `Return ONLY JSON: { sections: Array<{ title: string, points: string[], suggestImage?: boolean, imagePrompt?: string, alt?: string }> }.`
    ].join(' ');
    const json = await this._completeJson(prompt, 8192);
    if (json && Array.isArray(json.sections)) return json;
    return { sections: [] };
  }

  async generateContentPart({ niche, keyword, outline, partIndex, totalParts, previousContent = '' }) {
    const prompt = [
      `You are writing a multi-part long-form article (part ${partIndex} of ${totalParts}) targeting: "${keyword}" in the ${niche} niche.`,
      `Use markdown, include LSI keywords naturally, avoid repetition, keep a helpful tone.`,
      `Incorporate details from this outline: ${JSON.stringify(outline).slice(0, 6000)}.`,
      previousContent ? `Previously written content (for context, do not repeat): ${previousContent.slice(0, 4000)}` : '',
      `Rules:`,
      `- Do NOT include an H1 title (that is rendered separately)`,
      `- Keep section structure consistent with the outline (H2/H3)`,
      `- Continue exactly where the previous part stopped. Do NOT restart earlier sections or repeat any H2/H3 already covered.`,
      `- If a section heading was already started in the previous part, continue within that section without reprinting the same heading.`,
      `- If this is not the final part, do NOT write a conclusion or closing summary`,
      `- If this is the final part, add a concise conclusion at the end`,
      `- Avoid duplicating content already written in previous parts`
    ].join(' ');
    // request larger output per part (~700-900 words)
    return await this._completeText(prompt, 12000);
  }

  async generateMetaDescription({ title, niche, keyword }) {
    const prompt = `Write a 150-160 character meta description for an article titled "${title}" about ${keyword} in the ${niche} niche. Be compelling and natural.`;
    const text = await this._completeText(prompt, 512);
    return text.trim().slice(0, 160);
  }

  async _completeText(prompt, maxTokens = 2048) {
    return this.semaphore.run(async () => {
      const res = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: Math.min(maxTokens, 4096)
      });
      return res.choices?.[0]?.message?.content || '';
    });
  }

  async _completeJson(prompt, maxTokens = 4096) {
    const text = await this._completeText(prompt + '\nReturn ONLY valid JSON.', maxTokens);
    try {
      const start = text.indexOf('[');
      const brace = text.indexOf('{');
      const jsonStart = start >= 0 ? start : brace;
      const last = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'));
      const body = jsonStart >= 0 && last >= 0 ? text.slice(jsonStart, last + 1) : text;
      return JSON.parse(body);
    } catch (e) {
      // Fallback to a tiny safe structure
      return [];
    }
  }
}

function toTitleCase(s) {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace(/\b(And|Or|Of|The|To|In|On|For|A|An)\b/g, (m) => m.toLowerCase());
}

class Semaphore {
  constructor(max) {
    this.max = Math.max(1, max || 1);
    this.count = 0;
    this.queue = [];
  }
  async run(fn) {
    if (this.count >= this.max) await new Promise((r) => this.queue.push(r));
    this.count++;
    try {
      return await fn();
    } finally {
      this.count--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}


