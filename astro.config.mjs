import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// Site URL is required for sitemap & RSS absolute URLs
const SITE_URL = process.env.SITE_URL || 'http://localhost:4321';

export default defineConfig({
  site: SITE_URL,
  integrations: [mdx(), sitemap()],
  output: 'static',
  server: {
    host: true
  }
});


