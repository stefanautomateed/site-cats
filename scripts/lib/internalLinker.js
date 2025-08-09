import fsp from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';

export async function applyInternalLinks({ contentDir }) {
  const mdxPaths = await fg(['**/*.mdx'], { cwd: contentDir, dot: false, absolute: true });
  const posts = [];
  for (const p of mdxPaths) {
    const raw = await fsp.readFile(p, 'utf8');
    const { data, content } = matter(raw);
    if (!data?.slug) continue;
    posts.push({
      path: p,
      slug: String(data.slug),
      title: String(data.title || data.slug),
      cluster: String(data.cluster || 'Uncategorized'),
      keywords: Array.isArray(data.keywords) ? data.keywords.map(String) : [],
      content,
      data
    });
  }

  const byCluster = new Map();
  for (const post of posts) {
    const list = byCluster.get(post.cluster) || [];
    list.push(post);
    byCluster.set(post.cluster, list);
  }

  for (const post of posts) {
    const clusterPosts = (byCluster.get(post.cluster) || []).filter((p) => p.slug !== post.slug);
    if (clusterPosts.length === 0) continue;

    // Compute similarity based on keyword overlap then title token overlap
    const ranked = clusterPosts
      .map((p) => ({ p, score: similarity(post, p) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.p);

    const early = ranked.slice(0, 2);
    const end = ranked.slice(2, 5);

    // Previous/Next by slug alphabetically (stable)
    const sorted = [...clusterPosts, post].sort((a, b) => a.slug.localeCompare(b.slug));
    const idx = sorted.findIndex((x) => x.slug === post.slug);
    const prev = idx > 0 ? sorted[idx - 1] : null;
    const next = idx < sorted.length - 1 ? sorted[idx + 1] : null;

    // Prepare blocks
    const earlyBlock = blockWithLinks('You might also like', early);
    const endBlock = blockWithLinks(`More in ${post.cluster}`, end.length ? end : ranked.slice(0, 3));
    const navBlock = prevNextBlock(prev, next);

    const updated = insertBlocks(post.content, earlyBlock, endBlock, navBlock);
    const fileText = matter.stringify(updated, post.data);
    await fsp.writeFile(post.path, fileText, 'utf8');
  }
}

function similarity(a, b) {
  const A = new Set(a.keywords.map(normalizeToken).concat(tokenize(a.title)));
  const B = new Set(b.keywords.map(normalizeToken).concat(tokenize(b.title)));
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const denom = Math.max(1, A.size + B.size - inter);
  return inter / denom;
}

function normalizeToken(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(s) {
  return normalizeToken(s)
    .split(/\s+/)
    .filter(Boolean);
}

function blockWithLinks(title, items) {
  if (!items || items.length === 0) return '';
  const links = items.map((p) => `- [${p.title}](/${p.slug}/)`).join('\n');
  return `\n\n<!-- AUTOLINK-EARLY START -->\n\n### ${title}\n\n${links}\n\n<!-- AUTOLINK-EARLY END -->\n`;
}

function prevNextBlock(prev, next) {
  const parts = [];
  if (prev) parts.push(`[← ${prev.title}](/${prev.slug}/)`);
  if (next) parts.push(`[${next.title} →](/${next.slug}/)`);
  if (parts.length === 0) return '';
  return `\n\n<!-- AUTOLINK-NAV START -->\n\n---\n\n${parts.join(' | ')}\n\n<!-- AUTOLINK-NAV END -->\n`;
}

function insertBlocks(content, earlyBlock, endBlock, navBlock) {
  let out = content;
  // Early block after 2nd H2
  if (earlyBlock) {
    const idx = nthIndexOf(out, '\n## ', 2);
    if (idx !== -1 && !out.includes('<!-- AUTOLINK-EARLY START -->')) {
      const insertAt = out.indexOf('\n', idx + 1);
      out = out.slice(0, insertAt) + earlyBlock + out.slice(insertAt);
    }
  }
  // End related block (before any existing nav block)
  if (endBlock && !out.includes('<!-- AUTOLINK-EARLY START -->')) {
    out += endBlock;
  }
  // Prev/Next nav at very end
  if (navBlock && !out.includes('<!-- AUTOLINK-NAV START -->')) {
    out += navBlock;
  }
  return out;
}

function nthIndexOf(hay, needle, n) {
  let idx = -1;
  while (n-- > 0) {
    idx = hay.indexOf(needle, idx + 1);
    if (idx === -1) break;
  }
  return idx;
}


