/**
 * Public API for the ai-markdown-renderer core.
 * Import from 'ai-markdown-renderer'.
 */

import { MarkdownRenderer } from './renderer.js';
import type { RendererOptions } from './types.js';

export { MarkdownRenderer };
export type {
  RendererOptions,
  RenderDelta,
  Plugin,
  PluginHooks,
  ParseState,
  BlockMode,
  CodeFenceMeta,
  HighlightAdapter,
} from './types.js';

/**
 * One-shot markdown → HTML conversion.
 *
 * The simplest entry point for static (non-streaming) content.
 *
 * @example
 * import { renderMarkdown } from 'ai-markdown-renderer';
 * document.getElementById('output').innerHTML = renderMarkdown(markdownText);
 */
export function renderMarkdown(markdown: string, options?: RendererOptions): string {
  return MarkdownRenderer.render(markdown, options);
}
