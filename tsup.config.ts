import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export default defineConfig({
  entry: {
    'core/index': 'src/core/index.ts',
    'presets/standard': 'src/presets/standard.ts',
    'presets/full': 'src/presets/full.ts',
    'adapters/react/index': 'src/adapters/react/index.ts',
    'plugins/syntax-highlight/index': 'src/plugins/syntax-highlight/index.ts',
    'plugins/math/index': 'src/plugins/math/index.ts',
    'plugins/code-block/index': 'src/plugins/code-block/index.ts',
    'plugins/thinking/index': 'src/plugins/thinking/index.ts',
  },
  onSuccess: async () => {
    // Copy the default stylesheet to dist/styles/default.css
    const dest = 'dist/styles/default.css';
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync('src/styles/default.css', dest);
  },
  // Load .css files as plain text strings so they can be inlined into JS bundles
  // (used by src/styles/auto-inject.ts for automatic style injection).
  loader: { '.css': 'text' },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  clean: true,
  sourcemap: true,
  target: 'es2020',
  // markdown-it is bundled (not external) so the browser ESM build works without import maps.
  // Optional peer deps are kept external so users don't pay for unused features.
  external: ['react', 'react-dom', 'katex', 'shiki', 'highlight.js', 'prismjs'],
  noExternal: ['markdown-it'],
  outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
  treeshake: true,
});
