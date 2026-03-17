/**
 * Full preset — core + syntax highlighting + math (KaTeX).
 *
 * Peer dependencies required: highlight.js, katex
 *
 * Usage:
 *   import { createFullRenderer } from 'ai-markdown-renderer/presets/full';
 *   const renderer = createFullRenderer();
 */

import { MarkdownRenderer } from '../core/renderer.js';
import { createSyntaxHighlightPlugin, createHighlightJsAdapter } from '../plugins/syntax-highlight/index.js';
import { createMathPlugin } from '../plugins/math/index.js';
import type { RendererOptions } from '../core/types.js';
import type { MathPluginOptions } from '../plugins/math/index.js';

export type { MathPluginOptions };
export { MarkdownRenderer };

export interface FullRendererOptions extends Omit<RendererOptions, 'plugins'> {
  math?: MathPluginOptions;
  extraPlugins?: RendererOptions['plugins'];
}

/**
 * Creates a MarkdownRenderer with syntax highlighting and KaTeX math support.
 * Both highlight.js and katex are loaded lazily on first use.
 */
export function createFullRenderer(options: FullRendererOptions = {}): MarkdownRenderer {
  const { math = {}, extraPlugins = [], ...rest } = options;
  return new MarkdownRenderer({
    ...rest,
    plugins: [
      createSyntaxHighlightPlugin({ adapter: createHighlightJsAdapter() }),
      createMathPlugin(math),
      ...extraPlugins,
    ],
  });
}
