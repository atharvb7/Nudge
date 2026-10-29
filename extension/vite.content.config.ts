import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Content scripts can't be ES modules, so each is built as a self-contained IIFE.
// `--mode content` → content.js, `--mode bridge` → bridge.js
export default defineConfig(({ mode }) => {
  const entry = mode === 'bridge' ? 'src/content/bridge.ts' : 'src/content/content.ts';
  const name = mode === 'bridge' ? 'bridge' : 'content';
  return {
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      target: 'chrome116',
      copyPublicDir: false,
      lib: {
        entry: resolve(__dirname, entry),
        name: `nudge_${name}`,
        formats: ['iife'],
        fileName: () => `${name}.js`,
      },
    },
  };
});
