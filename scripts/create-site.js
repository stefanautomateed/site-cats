#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import sharp from 'sharp';
import { OpenAIClient } from './lib/openaiClient.js';
import { ReplicateClient } from './lib/replicateClient.js';
import { MockOpenAIClient, MockReplicateClient } from './lib/mockClients.js';
import { ensureDir, writeFileSafe, readJsonIfExists, sleep, emptyDir } from './lib/fileUtils.js';
import { slugifyString } from './lib/slugify.js';
import { initAndPushGit, ensureGitHubRepo } from './lib/githubClient.js';
import { ensureVercelProject } from './lib/vercelClient.js';
import { applyInternalLinks } from './lib/internalLinker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const [key, val] = token.replace(/^--/, '').split('=');
      const next = val !== undefined ? val : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
      args[key] = next;
    } else {
      args._.push(token);
    }
  }
  return args;
}

function getEnvNumber(name, fallback) {
  const raw = process.env[name];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main() {
  const args = parseArgs(process.argv);
  const niche = args._[0];
  if (!niche) {
    console.error('Usage: node scripts/create-site.js "<Niche Keyword>" [--max-posts N] [--batch N] [--concurrency N] [--no-images] [--no-deploy]');
    process.exit(1);
  }

  const maxPosts = parseInt(args['max-posts'] || process.env.MAX_POSTS_PER_RUN || '100', 10);
  const batchSize = parseInt(args['batch'] || process.env.POSTS_PER_BATCH || '50', 10);
  const concurrency = parseInt(args['concurrency'] || process.env.CONCURRENT_REQUESTS || '3', 10);
  const doImages = String(args['no-images'] || '').toLowerCase() === 'true' ? false : true;
  const doDeploy = String(args['no-deploy'] || '').toLowerCase() === 'true' ? false : true;
  const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.GPT_KEY;
  const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
  const mock = String(args['mock'] || '').toLowerCase() === 'true' || (!OPENAI_KEY);
  const clean = String(args['clean'] || '').toLowerCase() === 'true';

  const siteSlug = slugifyString(niche).slice(0, 60);
  const siteTitle = process.env.DEFAULT_SITE_TITLE || `${niche} Hub`;
  const siteTagline = process.env.DEFAULT_SITE_TAGLINE || `Expert insights, guides, and tips on ${niche}.`;

  const contentDir = path.join(root, 'content');
  const imagesDir = path.join(root, 'public', 'images');
  await ensureDir(contentDir);
  await ensureDir(imagesDir);

  if (clean) {
    console.log('Cleaning existing generated content...');
    await emptyDir(contentDir, { preserve: ['.gitkeep'] });
    await emptyDir(imagesDir, { preserve: ['.gitkeep'] });
  }

  const openai = mock
    ? new MockOpenAIClient()
    : new OpenAIClient({
        apiKey: OPENAI_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-4.1-nano',
        concurrency
      });
  const replicate = mock
    ? new MockReplicateClient()
    : new ReplicateClient({
        apiToken: REPLICATE_TOKEN,
        model: process.env.REPLICATE_MODEL || 'black-forest-labs/flux-dev'
      });

  // Brand + static pages
  console.log(`Generating brand and static pages for: ${niche}`);
  const brand = await openai.generateBrand(niche);
  const staticPages = await openai.generateStaticPages({ niche, brand });
  await writeBrandConfig({ brand });
  await generateBrandAssets({ brand });
  await writeStaticPages({ brand, staticPages });

  console.log(`Generating site plan for niche: ${niche}${mock ? ' (mock)' : ''}`);
  let plan = await openai.generateSitePlan(niche, { clustersTarget: 450, subtopicsPerCluster: [8, 12], siteTitle, siteTagline });
  if (!Array.isArray(plan) || plan.length === 0) {
    console.warn('Received empty site plan. Falling back to mock plan with 10 clusters.');
    const fallback = new MockOpenAIClient();
    plan = await fallback.generateSitePlan(niche, { clustersTarget: 10, subtopicsPerCluster: [8, 12], siteTitle, siteTagline });
  }

  let totalKeywords = 0;
  for (const c of plan) totalKeywords += (c.keywords?.length || 0);
  console.log(`Plan ready: ${plan.length} clusters, ~${totalKeywords} keywords.`);

  // Flatten to target maxPosts
  const allTasks = [];
  for (const cluster of plan) {
    for (const keyword of cluster.keywords || []) {
      allTasks.push({ cluster: cluster.cluster, keyword });
    }
  }
  const targetTasks = allTasks.slice(0, maxPosts);

  // Process in batches
  for (let i = 0; i < targetTasks.length; i += batchSize) {
    const batch = targetTasks.slice(i, i + batchSize);
    console.log(`Processing batch ${i / batchSize + 1} / ${Math.ceil(targetTasks.length / batchSize)} (${batch.length} posts)`);
    await processBatch({ batch, niche, contentDir, imagesDir, openai, replicate, doImages });
  }

  console.log('Applying internal links...');
  await applyInternalLinks({ contentDir });

  if (doDeploy) {
    const repoName = `site-${siteSlug}`;
    const { html_url, ssh_url, clone_url } = await ensureGitHubRepo({ repoName });
    await initAndPushGit({ remoteUrl: clone_url });
    await ensureVercelProject({ projectName: repoName, repoUrl: html_url });
  }

  console.log('Done.');
}

async function processBatch({ batch, niche, contentDir, imagesDir, openai, replicate, doImages }) {
  // Outline -> Content parts -> Write MDX -> Images -> Related links
  const postMetas = [];

  for (const task of batch) {
    const title = titleCase(task.keyword);
    const slug = slugifyString(task.keyword);
    const date = new Date().toISOString().slice(0, 10);
    const clusterSlug = slugifyString(task.cluster || 'misc');
    const postDir = path.join(contentDir, clusterSlug);
    await ensureDir(postDir);

    // SEO + Outline
    const seo = await openai.generateSeoData({ niche, keyword: task.keyword });
    const outline = await openai.generateOutline({ niche, keyword: task.keyword });

    // Content parts with continuity (3 parts ~700+ words each)
    const part1 = await openai.generateContentPart({ niche, keyword: task.keyword, outline, partIndex: 1, totalParts: 3 });
    const part2 = await openai.generateContentPart({ niche, keyword: task.keyword, outline, partIndex: 2, totalParts: 3, previousContent: part1 });
    const prev = `${part1}\n\n${part2}`.slice(0, 6000);
    const part3 = await openai.generateContentPart({ niche, keyword: task.keyword, outline, partIndex: 3, totalParts: 3, previousContent: prev });

    // Meta description (prefer SEO description)
    const metaDescription = seo.description || (await openai.generateMetaDescription({ title: seo.title || title, niche, keyword: task.keyword }));

    // Build MDX body and collect image prompts
    const hero = buildHeroSection({ title: seo.title || title, slug, image: `/images/${slug}/cover.webp`, description: metaDescription });
    const { mdxBody, imagePrompts } = composeMdxBody({ outline, parts: [part1, part2, part3], keyword: task.keyword, slug });

    const coverImagePath = `/images/${slug}/cover.webp`;
    const frontmatter = {
      title: seo.title || title,
      slug,
      date,
      description: metaDescription,
      keywords: [task.keyword, niche, ...(seo.lsi || [])],
      image: coverImagePath,
      cluster: task.cluster
    };

    const mdxContent = stringifyFrontmatter(frontmatter) + '\n' + hero + '\n' + mdxBody + '\n';
    const mdxFilePath = path.join(postDir, `${slug}.mdx`);
    await writeFileSafe(mdxFilePath, mdxContent);

    postMetas.push({ slug, title, cluster: task.cluster, mdxFilePath });

    if (doImages) {
      const postImagesDir = path.join(imagesDir, slug);
      await ensureDir(postImagesDir);
      // Generate cover first
      try {
        await replicate.generateAndSaveWebp({
          prompt: `${title} — ${niche}. Realistic editorial photo, clean composition, natural lighting, high detail.`,
          outputPath: path.join(postImagesDir, `cover.webp`)
        });
      } catch (e) {
        console.warn(`Cover image failed for ${slug}:`, e.message);
        await createPlaceholder(path.join(postImagesDir, `cover.webp`));
      }
      // Inline images
      for (let idx = 0; idx < imagePrompts.length; idx++) {
        const prompt = imagePrompts[idx];
        try {
          await replicate.generateAndSaveWebp({ prompt, outputPath: path.join(postImagesDir, `img${idx + 1}.webp`) });
        } catch (e) {
          console.warn(`Inline image ${idx + 1} failed for ${slug}:`, e.message);
          await createPlaceholder(path.join(postImagesDir, `img${idx + 1}.webp`));
        }
      }
    }
  }

  // Add related links within same cluster (simple pass)
  await addRelatedLinks(postMetas);
}

function titleCase(s) {
  return s
    .split(/\s+/)
    .map((w) => w[0] ? w[0].toUpperCase() + w.slice(1) : w)
    .join(' ')
    .replace(/\b([aAiIoOfOfToAndThe])\b/g, (m) => m.toLowerCase());
}

function stringifyFrontmatter(obj) {
  const yaml = Object.entries(obj)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.map((x) => JSON.stringify(x)).join(', ')}]`;
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join('\n');
  return `---\n${yaml}\n---`;
}

function composeMdxBody({ outline, parts, keyword, slug }) {
  // The outline contains headings and suggested image placements e.g. { h2: [...], h3: {...}, imagesAfterH2: [2,4] }
  const imagePrompts = [];
  let md = '';
  if (Array.isArray(outline?.sections)) {
    outline.sections.forEach((sec, idx) => {
      md += `\n\n## ${sec.title}\n\n`;
      if (Array.isArray(sec.points)) {
        md += sec.points.map((p) => `- ${p}`).join('\n') + '\n\n';
      }
      // Suggested image after some sections
      if (sec.suggestImage === true) {
        const p = sec.imagePrompt || `${sec.title} — detailed, editorial style illustrative image, coherent with article tone.`;
        const alt = sec.alt || sec.title;
        imagePrompts.push(p);
        const imgIndex = imagePrompts.length;
        md += `\n![${alt}](/images/${slug}/img${imgIndex}.webp)\n\n`;
      }
    });
  }

  // Append parts (generated prose) and interleave images using last section context
  for (let i = 0; i < parts.length; i++) {
    md += `\n\n${parts[i]}\n\n`;
    if (i < parts.length - 1) {
      // Use the last section title as context for the inter-part image if available
      let lastTitle = '';
      if (Array.isArray(outline?.sections) && outline.sections.length > 0) {
        lastTitle = outline.sections[Math.min(i, outline.sections.length - 1)]?.title || '';
      }
      const prompt = lastTitle
        ? `${lastTitle} — contextual editorial illustration, consistent style`
        : `Illustration related to ${keyword} — contextual editorial style`;
      imagePrompts.push(prompt);
      const imgIndex = imagePrompts.length;
      md += `\n![${lastTitle || `Illustration for ${keyword}`}](/images/${slug}/img${imgIndex}.webp)\n\n`;
    }
  }
  return { mdxBody: md.trim(), imagePrompts };
}

function buildHeroSection({ title, slug, image, description }) {
  return `\n<section style=\"margin:1rem 0 2rem; padding:1rem; border-radius:12px; background:#0b1020; border:1px solid #1f2937; display:flex; gap:16px; align-items:center;\">\n  <img src=\"${image}\" alt=\"${title}\" style=\"width:160px; height:160px; object-fit:cover; border-radius:12px; border:1px solid #374151;\"/>\n  <div>\n    <h1 style=\"margin:0 0 .5rem\">${title}</h1>\n    <p style=\"margin:0; color:#9ca3af\">${description || ''}</p>\n  </div>\n</section>\n`;
}

async function createPlaceholder(outputPath) {
  try {
    await sharp({
      create: {
        width: 1200,
        height: 675,
        channels: 3,
        background: { r: 30, g: 41, b: 59 }
      }
    })
      .webp({ quality: 70 })
      .toFile(outputPath);
  } catch {}
}

async function addRelatedLinks(postMetas) {
  const byCluster = new Map();
  for (const meta of postMetas) {
    const list = byCluster.get(meta.cluster) || [];
    list.push(meta);
    byCluster.set(meta.cluster, list);
  }
  for (const [cluster, list] of byCluster) {
    for (const meta of list) {
      const others = list.filter((m) => m.slug !== meta.slug);
      const picks = shuffle(others).slice(0, 3);
      if (picks.length === 0) continue;
      const links = picks.map((p) => `- [${p.title}](/${p.slug}/)`).join('\n');
      const block = `\n\n---\n\n### Related in ${cluster}\n\n${links}\n`;
      const original = await fsp.readFile(meta.mdxFilePath, 'utf8');
      await fsp.writeFile(meta.mdxFilePath, original + block, 'utf8');
    }
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function writeStaticPages({ brand, staticPages }) {
  const pagesDir = path.join(root, 'src', 'pages');
  await ensureDir(pagesDir);

  const heroBlock = `<section style=\"margin:1rem 0 1.5rem;padding:1.25rem;border:1px solid #1f2937;border-radius:12px;background:#0b1020\">\n  <h1 style=\"margin:0 0 .5rem\">${staticPages.hero.title}</h1>\n  <p style=\"margin:0 0 .75rem;color:#9ca3af\">${staticPages.hero.subtitle}</p>\n  <a href=\"/site/\" style=\"display:inline-block;background:linear-gradient(90deg,#6366f1,#06b6d4);padding:.6rem 1rem;border-radius:10px;color:#fff;text-decoration:none;font-weight:700;\">${staticPages.hero.ctaText}</a>\n</section>`;

  // Overwrite About/Contact/Privacy/Terms using generated copy
  await writeFileSafe(path.join(pagesDir, 'about.astro'), `---\nimport Base from '../layouts/Base.astro';\nimport Header from '../components/Header.astro';\nimport Footer from '../components/Footer.astro';\n---\n<Base title="About">\n  <Fragment slot=\"header\"><Header /></Fragment>\n  ${staticPages.about}\n  <Fragment slot=\"footer\"><Footer /></Fragment>\n</Base>\n`);

  await writeFileSafe(path.join(pagesDir, 'contact.astro'), `---\nimport Base from '../layouts/Base.astro';\nimport Header from '../components/Header.astro';\nimport Footer from '../components/Footer.astro';\n---\n<Base title="Contact">\n  <Fragment slot=\"header\"><Header /></Fragment>\n  ${staticPages.contact}\n  <Fragment slot=\"footer\"><Footer /></Fragment>\n</Base>\n`);

  await writeFileSafe(path.join(pagesDir, 'privacy.astro'), `---\nimport Base from '../layouts/Base.astro';\nimport Header from '../components/Header.astro';\nimport Footer from '../components/Footer.astro';\n---\n<Base title="Privacy Policy">\n  <Fragment slot=\"header\"><Header /></Fragment>\n  ${staticPages.privacy}\n  <Fragment slot=\"footer\"><Footer /></Fragment>\n</Base>\n`);

  await writeFileSafe(path.join(pagesDir, 'terms.astro'), `---\nimport Base from '../layouts/Base.astro';\nimport Header from '../components/Header.astro';\nimport Footer from '../components/Footer.astro';\n---\n<Base title="Terms of Service">\n  <Fragment slot=\"header\"><Header /></Fragment>\n  ${staticPages.terms}\n  <Fragment slot=\"footer\"><Footer /></Fragment>\n</Base>\n`);

  // Inject homepage hero by replacing HERO block
  const indexPath = path.join(root, 'src', 'pages', 'index.astro');
  try {
    const current = await fsp.readFile(indexPath, 'utf8');
    const updated = current.replace(/<!-- HERO START -->[\s\S]*?<!-- HERO END -->/, `<!-- HERO START -->\n${heroBlock}\n<!-- HERO END -->`);
    await fsp.writeFile(indexPath, updated, 'utf8');
  } catch {}
}

async function writeBrandConfig({ brand }) {
  const dataDir = path.join(root, 'public');
  await ensureDir(dataDir);
  await writeFileSafe(path.join(dataDir, 'brand.json'), JSON.stringify(brand, null, 2));
}

async function generateBrandAssets({ brand }) {
  const publicDir = path.join(root, 'public');
  await ensureDir(publicDir);
  const logoPath = path.join(publicDir, 'logo.png');
  const favPath = path.join(publicDir, 'favicon.ico');
  try {
    await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 30, g: 41, b: 59 } } })
      .png()
      .toFile(logoPath);
    await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 30, g: 41, b: 59 } } })
      .png()
      .toFile(favPath);
  } catch {}
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


