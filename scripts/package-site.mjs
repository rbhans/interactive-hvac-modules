#!/usr/bin/env node
/**
 * Lay the static export out under the path robboborben.xyz serves it at, for the bas-lab Worker:
 * dist/site/tools/bas-lab/…  Run after `npm run site:build`. (With a custom distDir, Next writes
 * the export into it, so it comes from .next-build/, not out/.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = 'tools/bas-lab';
const OUT = path.join(ROOT, '.next-build');
const SITE = path.join(ROOT, 'dist', 'site');
const DEST = path.join(SITE, PREFIX);

if (!fs.existsSync(path.join(OUT, 'index.html'))) {
  console.error('no .next-build/index.html: run `npm run site:build` first');
  process.exit(1);
}

fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });
fs.cpSync(OUT, DEST, { recursive: true });

// every page and every module's scene and airflow field must have made it
const html = fs.readFileSync(path.join(DEST, 'index.html'), 'utf8');
const missing = [
  'index.html',
  '404.html',
  'lessons/economizer/index.html',
  ...['economizer', 'coils'].flatMap((m) => [`lab/${m}/index.html`, `lab/${m}/scene.glb`, `lab/${m}/flow.json`, `lab/${m}/flow.bin.gz`]),
].filter((f) => !fs.existsSync(path.join(DEST, f)));
if (missing.length) {
  console.error(`missing from the export: ${missing.join(', ')}`);
  process.exit(1);
}
if (!html.includes(`/${PREFIX}/_next/`)) {
  console.error(`index.html doesn't load its scripts from /${PREFIX}/_next/: was it built with BASE_PATH=/${PREFIX}?`);
  process.exit(1);
}

let files = 0;
let bytes = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else {
      files++;
      bytes += fs.statSync(p).size;
      if (fs.statSync(p).size > 25 * 1024 * 1024) {
        console.error(`${path.relative(SITE, p)} is over Workers' 25 MiB asset limit`);
        process.exit(1);
      }
    }
  }
};
walk(SITE);
console.log(`dist/site/${PREFIX}: ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
