// Builds .dev-data/ for `npm run dev`: the same files the Pages deploy publishes in /data/.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const out = resolve(import.meta.dirname, '..', '.dev-data');
mkdirSync(out, { recursive: true });
const python = process.platform === 'win32' ? 'python' : 'python3';
execFileSync(python, [resolve(root, '.github/scripts/export_futures_json.py'), resolve(root, 'futures_prices.db'), resolve(out, 'futures.json')], { stdio: 'inherit' });
copyFileSync(resolve(root, 'futures_prices.db'), resolve(out, 'futures_prices.db'));
