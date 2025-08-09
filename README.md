## Automated Static Site Factory (Astro)

End-to-end tool to generate and deploy massive static blogs (4k–5k posts) per niche using Astro, OpenAI, and Replicate. One CLI command creates a full site, pushes to GitHub, and deploys to Vercel.

### Prerequisites
- Node.js 18.17+
- Git installed and authenticated
- Accounts/API keys: OpenAI, Replicate, GitHub, Vercel

### Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy env and fill values:
   ```bash
   cp .env.example .env
   ```
3. Optional: set `SITE_URL` (used for sitemap and RSS).

### Run locally
```bash
npm run dev
```

### Generate a site
```bash
npm run create-site -- "Organic Gardening" --max-posts 1000 --batch 500
```

Flags:
- `--max-posts` limit total posts for this run (default from env `MAX_POSTS_PER_RUN`)
- `--batch` number of posts per batch (default from env `POSTS_PER_BATCH`)
- `--concurrency` parallel API calls (default from env `CONCURRENT_REQUESTS`)
- `--no-images` skip image generation
- `--no-deploy` skip GitHub/Vercel deployment

### Project Structure
```
content/               # generated .mdx posts (cluster directories)
public/images/         # generated images (webp)
src/pages/             # Astro pages
scripts/               # Node.js automation
```

### Deployment
- Script initializes a new git repo (if needed), creates a GitHub repo, pushes, then creates a Vercel project and triggers deploy.
- Configure custom domain on Vercel if desired.

### Notes
- For very large sites, run multiple times in batches (e.g. 500–1000 posts per run).
- Content variation and anti-duplication prompts are implemented to reduce repetition.
- Images use Replicate Black Forest Labs FLUX; change model via `REPLICATE_MODEL`.


