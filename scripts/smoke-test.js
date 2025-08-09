#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const niches = [
  'home workouts',
  'ebook writing',
  'pranking'
];

async function main() {
  for (const niche of niches) {
    console.log(`\n=== Generating niche: ${niche} ===`);
    await runNode(['scripts/create-site.js', niche, '--max-posts', '5', '--batch', '5', '--concurrency', '2', '--no-images', '--no-deploy', '--clean', 'true']);
    await runNpm(['run', 'build']);
  }
  console.log('\nSmoke test complete.');
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', shell: false });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`node ${args.join(' ')} failed (${code})`))));
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


