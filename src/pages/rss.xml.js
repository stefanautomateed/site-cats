import rss from '@astrojs/rss';

export async function GET(context) {
  const modules = import.meta.glob('../../content/**/*.mdx');
  const loaded = await Promise.all(Object.values(modules).map((l) => l()));

  const items = loaded
    .map((m) => ({
      title: m.frontmatter?.title || m.frontmatter?.slug,
      pubDate: new Date(m.frontmatter?.date || Date.now()),
      description: m.frontmatter?.description || '',
      link: `/${m.frontmatter?.slug}/`
    }))
    .filter((i) => !!i.link);

  return rss({
    title: 'Site RSS',
    description: 'Generated RSS feed',
    site: new URL(context.site).origin,
    items
  });
}


