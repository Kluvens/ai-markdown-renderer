/**
 * Standard preset — core + syntax highlighting (highlight.js).
 *
 * Usage:
 *   import { MarkdownRenderer, createStandardRenderer } from 'ai-markdown-renderer/presets/standard';
 */

import { MarkdownRenderer } from '../core/renderer.js';
import { createSyntaxHighlightPlugin, createHighlightJsAdapter } from '../plugins/syntax-highlight/index.js';
import type { RendererOptions } from '../core/types.js';

export { MarkdownRenderer };
export type { RendererOptions };

/**
 * Creates a MarkdownRenderer pre-configured with syntax highlighting via highlight.js.
 * highlight.js is loaded lazily on first code block render.
 */
export function createStandardRenderer(options: Omit<RendererOptions, 'plugins'> & {
  extraPlugins?: RendererOptions['plugins'];
} = {}): MarkdownRenderer {
  const { extraPlugins = [], ...rest } = options;
  return new MarkdownRenderer({
    ...rest,
    plugins: [
      createSyntaxHighlightPlugin({ adapter: createHighlightJsAdapter() }),
      ...extraPlugins,
    ],
  });
}
