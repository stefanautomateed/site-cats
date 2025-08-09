import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

export async function writeFileSafe(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, content, 'utf8');
}

export async function readJsonIfExists(filePath) {
  try {
    const txt = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

export async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function emptyDir(targetDir, { preserve = [] } = {}) {
  try {
    const entries = await fsp.readdir(targetDir, { withFileTypes: true });
    for (const entry of entries) {
      const p = path.join(targetDir, entry.name);
      if (preserve.includes(entry.name)) continue;
      if (entry.isDirectory()) {
        await emptyDir(p, { preserve: [] });
        await fsp.rmdir(p).catch(async () => {
          // Fallback in case of not empty
          const inner = await fsp.readdir(p);
          if (inner.length === 0) return;
        });
      } else {
        await fsp.unlink(p).catch(() => {});
      }
    }
  } catch {}
}


