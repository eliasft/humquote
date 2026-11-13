// Assembles the GitHub Pages site into ../_site (or the folder given as the first
// argument), exactly as the deploy publishes it. Run `npm run build` first.
//   /           site/ (landing page, version A in /a/, redirects for old links)
//   /a/core.js  the shared calculations (dist-core/core.js)
//   /b/         version B (dist/)
//   /data/      futures.json, the database and images
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const app = resolve(import.meta.dirname, '..');
const out = resolve(process.argv[2] ?? resolve(root, '_site'));

for (const built of ['dist/index.html', 'dist-core/core.js']) {
  if (!existsSync(resolve(app, built))) throw new Error(`Missing app-b/${built}: run npm run build first.`);
}

rmSync(out, { recursive: true, force: true });
cpSync(resolve(root, 'site'), out, { recursive: true });
cpSync(resolve(app, 'dist-core/core.js'), resolve(out, 'a/core.js'));
cpSync(resolve(app, 'dist'), resolve(out, 'b'), { recursive: true });

const data = resolve(out, 'data');
mkdirSync(data, { recursive: true });
for (const f of ['futures_prices.db', 'hum-solar-header.jpg', 'logo_hum.png']) cpSync(resolve(root, f), resolve(data, f));
const python = process.platform === 'win32' ? 'python' : 'python3';
execFileSync(python, [resolve(root, '.github/scripts/export_futures_json.py'), resolve(root, 'futures_prices.db'), resolve(data, 'futures.json')], { stdio: 'inherit' });
console.log(`Site assembled in ${out}`);
