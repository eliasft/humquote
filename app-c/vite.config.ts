import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Published at https://<user>.github.io/humquote/c/, with shared data at /humquote/data/.
const BASE = '/humquote/c/';
const DEV_DATA = resolve(import.meta.dirname, '.dev-data');

export default defineConfig({
  base: BASE,
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  plugins: [
    react(),
    tailwindcss(),
    {
      // In dev, serve /humquote/data/* from .dev-data/ (built by `npm run data`).
      name: 'dev-data',
      configureServer(server) {
        server.middlewares.use('/humquote/data/', (req, res, next) => {
          const file = resolve(DEV_DATA, decodeURIComponent((req.url ?? '').split('?')[0].replace(/^\//, '')));
          if (!file.startsWith(DEV_DATA) || !existsSync(file)) return next();
          res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
          res.end(readFileSync(file));
        });
      },
    },
  ],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
