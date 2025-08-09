#!/usr/bin/env node
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Simple UI
app.get('/', (req, res) => {
  res.send(`
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Autoblogger UI</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        body { font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; }
        .wrap { max-width: 880px; margin: 64px auto; padding: 0 20px; }
        .card { background: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.35); }
        h1 { margin: 0 0 8px; font-size: 28px; }
        p { color: #9ca3af; }
        label { display: block; margin: 16px 0 8px; font-weight: 600; }
        input[type=text], input[type=number] { width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid #374151; background: #0b1020; color: #e5e7eb; }
        .row { display: flex; gap: 16px; }
        .row > div { flex: 1; }
        button { background: linear-gradient(90deg, #6366f1, #06b6d4); border: none; color: white; padding: 12px 16px; border-radius: 10px; font-weight: 700; cursor: pointer; }
        button:disabled { opacity: .6; cursor: not-allowed; }
        .status { margin-top: 12px; color: #a3e635; min-height: 1.5em; }
        .link { margin-top: 16px; }
        a { color: #22d3ee; text-decoration: none; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="card">
          <h1>Autoblogger</h1>
          <p>Generate a small demo site to preview. Uses your configured API keys. Images can be toggled.</p>
          <form id="f">
            <label>Keyword / Niche</label>
            <input type="text" name="kw" placeholder="e.g. Organic Gardening" required />
            <div class="row">
              <div>
                <label>Posts (max)</label>
                <input type="number" name="max" min="1" max="50" value="10" />
              </div>
              <div>
                <label>Batch size</label>
                <input type="number" name="batch" min="1" max="50" value="10" />
              </div>
              <div>
                <label>Concurrency</label>
                <input type="number" name="cc" min="1" max="5" value="2" />
              </div>
            </div>
            <div class="row">
              <div>
                <label>Images</label>
                <input type="checkbox" name="images" checked />
              </div>
              <div>
                <label>Mock content</label>
                <input type="checkbox" name="mock" />
              </div>
              <div>
                <label>Clean existing content</label>
                <input type="checkbox" name="clean" />
              </div>
            </div>
            <div style="margin-top: 16px; display: flex; gap: 12px; align-items: center;">
              <button type="submit">Generate</button>
              <div class="status" id="status"></div>
            </div>
          </form>
          <div class="link" id="link"></div>
        </div>
      </div>
      <script>
        const f = document.getElementById('f');
        const status = document.getElementById('status');
        const link = document.getElementById('link');
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          status.textContent = 'Starting...';
          link.innerHTML = '';
          const data = Object.fromEntries(new FormData(f).entries());
          const body = {
            kw: data.kw,
            max: Number(data.max || 10),
            batch: Number(data.batch || 10),
            cc: Number(data.cc || 2),
            images: !!data.images,
            mock: !!data.mock,
            clean: !!data.clean
          };
          const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const json = await res.json();
          if (!res.ok) { status.textContent = 'Error: ' + (json.error || res.status); return; }
          status.textContent = json.message || 'Done';
          link.innerHTML = '<a href="/site/" target="_blank">Open preview site</a> (open links from homepage)';
        });
      </script>
    </body>
  </html>`);
});

app.post('/api/generate', async (req, res) => {
  try {
    const { kw, max = 10, batch = 10, cc = 2, images = true, mock = false, clean = false } = req.body || {};
    if (!kw) return res.status(400).json({ error: 'kw is required' });

    // Run the generator as a child process
    const args = [path.join(root, 'scripts', 'create-site.js'), String(kw), '--max-posts', String(max), '--batch', String(batch), '--concurrency', String(cc)];
    if (!images) args.push('--no-images');
    args.push('--no-deploy');
    if (mock) args.push('--mock', 'true');
    if (clean) args.push('--clean', 'true');

    await runNode(args);

    // Build the site
    await runNpm(['run', 'build']);

    res.json({ ok: true, message: `Generated ${max} post(s) for "${kw}".`, site: '/site/' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'generation failed' });
  }
});

// Serve built site at /site and ensure absolute /images/* works
const distDir = path.join(root, 'dist');
app.use('/site', express.static(distDir));
app.use('/images', express.static(path.join(distDir, 'images')));

const PORT = process.env.UI_PORT || 5175;
app.listen(PORT, () => {
  console.log(`Autoblogger UI running at http://localhost:${PORT}`);
});

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', shell: false });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Process failed with code ${code}`))));
  });
}

function runNpm(args) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'npm.cmd' : 'npm';
    const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: isWin });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`npm ${args.join(' ')} failed (${code})`))));
  });
}


