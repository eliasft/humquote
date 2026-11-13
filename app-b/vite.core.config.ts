import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Builds src/core into dist-core/core.js: the calculations, contract periods and
// tariff catalogue as one ES module for version A. Not minified, so it stays readable.
export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  build: {
    outDir: 'dist-core',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/core/index.ts'),
      formats: ['es'],
      fileName: () => 'core.js',
    },
  },
});
