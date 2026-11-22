// Incorpora i file della PWA (cartella web/) nel Worker come modulo JS generato.
// Eseguito automaticamente da wrangler prima di deploy/dev (vedi [build] in wrangler.toml).
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '../../web');
const OUT = path.resolve(here, '../src/static-assets.js');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
  '.ico': 'image/x-icon',
};

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out;
}

const files = {};
for (const f of (await walk(WEB)).sort()) {
  const ext = path.extname(f);
  if (!TYPES[ext]) continue;
  const buf = await readFile(f);
  const rel = '/' + path.relative(WEB, f).split(path.sep).join('/');
  const binary = !TYPES[ext].startsWith('text/') && !ext.match(/\.(svg|webmanifest|json)$/);
  files[rel] = {
    type: TYPES[ext],
    etag: '"' + createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"',
    ...(binary ? { b64: buf.toString('base64') } : { text: buf.toString('utf8') }),
  };
}
await writeFile(OUT, '// File generato da scripts/build-static.mjs: non modificare.\nexport default ' + JSON.stringify(files) + ';\n');
console.log(`static-assets: ${Object.keys(files).length} file`);
