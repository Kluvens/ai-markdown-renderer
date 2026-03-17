/**
 * AI Thinking Block Plugin
 *
 * Renders <think>...</think> blocks emitted by reasoning models
 * (Claude extended thinking, DeepSeek R1, QwQ, etc.) as a collapsible
 * details/summary element with styled content.
 *
 * During streaming the speculative renderer shows an animated "thinking"
 * indicator. Once committed (</think> received), this plugin converts
 * the raw block into a clean disclosure widget.
 *
 * Usage:
 *   import { createThinkingPlugin } from 'ai-markdown-renderer/plugins/thinking';
 *
 *   const renderer = new MarkdownRenderer({
 *     plugins: [createThinkingPlugin()],
 *   });
 */

import type { Plugin } from '../../core/types.js';

export interface ThinkingPluginOptions {
  /**
   * Label shown in the summary/header.
   * Default: 'Thinking'
   */
  headerLabel?: string;
  /**
   * Whether the <details> element is open (expanded) by default.
   * Default: false
   */
  defaultOpen?: boolean;
  /**
   * CSS class prefix for all generated elements.
   * Default: 'ai-thinking'
   */
  classPrefix?: string;
}

export function createThinkingPlugin(options: ThinkingPluginOptions = {}): Plugin {
  const {
    headerLabel = 'Thinking',
    defaultOpen = false,
    classPrefix = 'ai-thinking',
  } = options;

  return {
    name: 'thinking',
    hooks: {
      'after-render': (html: string, rawBlock: string): string => {
        const trimmed = rawBlock.trimStart();
        if (!THINK_OPEN_RE.test(trimmed)) return html;

        // Extract the content between <think> and </think>
        const inner = extractThinkContent(rawBlock);
        const openAttr = defaultOpen ? ' open' : '';

        return (
          `<details class="${classPrefix}-block"${openAttr}>\n` +
          `<summary class="${classPrefix}-summary">` +
          `<span class="${classPrefix}-icon">◆</span> ` +
          escapeHtml(headerLabel) +
          `</summary>\n` +
          `<div class="${classPrefix}-content">${inner}</div>\n` +
          `</details>\n`
        );
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const THINK_OPEN_RE = /^<think\b[^>]*/i;

/**
 * Extracts the content inside <think ...>...</think>.
 * Handles both plain <think> and attributed variants like <think type="...">.
 */
function extractThinkContent(rawBlock: string): string {
  // Find the end of the opening tag (first >)
  const openEnd = rawBlock.indexOf('>');
  if (openEnd === -1) return '';

  let inner = rawBlock.slice(openEnd + 1);

  // Strip closing </think> tag if present
  inner = inner.replace(/<\/think\s*>\s*$/i, '');

  return escapeHtml(inner.trim());
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
