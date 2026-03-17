/**
 * SpeculativeRenderer
 *
 * Renders the current in-progress (speculative) buffer for real-time display.
 * Called on every push() after the block splitter has processed the chunk.
 *
 * Special cases by mode:
 *   think-block → emits a streaming "thinking" indicator (not raw reasoning text)
 *   math-block  → shows a placeholder with raw LaTeX (avoids KaTeX error flashes)
 *   table       → injects `ai-table-streaming` class so apps can add a loading shimmer
 *   others      → applyGracefulDegradation() + markdown-it, with partial inline math
 *                 stripped from linePending to prevent literal→rendered blink
 */

import type MarkdownIt from 'markdown-it';
import type { ParseState, Plugin } from './types.js';
import type { StreamingBlockSplitter } from './streaming-block-splitter.js';

export class SpeculativeRenderer {
  private readonly md: MarkdownIt;
  private readonly plugins: Plugin[];

  constructor(md: MarkdownIt, plugins: Plugin[]) {
    this.md = md;
    this.plugins = plugins;
  }

  /**
   * Render the current speculative buffer to HTML for display.
   * Returns empty string if the buffer is empty.
   */
  render(splitter: StreamingBlockSplitter, state: Readonly<ParseState>): string {
    const raw = splitter.getSpeculativeBuffer();
    if (!raw.trim()) return '';

    // ---- think-block: show animated indicator instead of raw reasoning ----
    if (state.mode === 'think-block') {
      return '<div class="ai-thinking-streaming"><span class="ai-thinking-dot"></span><span class="ai-thinking-dot"></span><span class="ai-thinking-dot"></span></div>\n';
    }

    // ---- math-block: show a plain placeholder instead of running KaTeX on
    //      partial LaTeX (which produces jarring red error flashes mid-stream) ----
    if (state.mode === 'math-block') {
      const latexContent = state.speculativeBuffer.replace(/^\$\$\n?/, '') + splitter.pendingLine;
      const escaped = escapeHtml(latexContent);
      return `<div class="ai-math-loading"><pre>${escaped}</pre></div>\n`;
    }

    // For other modes, suppress any unclosed inline $…$ in the pending line to
    // avoid the literal-text → KaTeX transform blink when the closing $ arrives.
    const safePending = suppressPartialInlineMath(splitter.pendingLine);
    const safeRaw = state.speculativeBuffer + safePending;

    // Block-level graceful degradation (closes code fences, math blocks, think blocks)
    const graceful = splitter.applyGracefulDegradation(safeRaw);

    // Plugin before-commit hooks
    let processed = graceful;
    for (const plugin of this.plugins) {
      if (plugin.hooks?.['before-commit']) {
        processed = plugin.hooks['before-commit'](processed, state);
      }
    }

    // Render via markdown-it
    let html = this.md.render(processed);

    // ---- table: inject streaming class so apps can add a shimmer/pulse ----
    if (state.mode === 'table') {
      html = html.replace('<table>', '<table class="ai-table-streaming">');
    }

    // Plugin after-render hooks
    for (const plugin of this.plugins) {
      if (plugin.hooks?.['after-render']) {
        html = plugin.hooks['after-render'](html, processed);
      }
    }

    return html;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strips any unclosed inline $…$ math span from the end of a partial line.
 *
 * Scans left-to-right counting unescaped `$` delimiters (skipping `$$` pairs
 * that open block math and `\$` escaped dollars). If the count is odd the last
 * unclosed `$` and everything after it is removed so markdown-it renders the
 * preceding text as plain text instead of a partial math token.
 */
function suppressPartialInlineMath(pending: string): string {
  let dollarCount = 0;
  let lastDollarIdx = -1;

  for (let i = 0; i < pending.length; i++) {
    const ch = pending[i];

    // Skip escaped dollar
    if (ch === '\\' && pending[i + 1] === '$') {
      i++;
      continue;
    }

    // Skip $$ (block math delimiter — not an inline opener)
    if (ch === '$' && pending[i + 1] === '$') {
      i++;
      continue;
    }

    if (ch === '$') {
      dollarCount++;
      lastDollarIdx = i;
    }
  }

  // Odd count → unclosed inline math; strip from the last $ onward
  if (dollarCount % 2 !== 0 && lastDollarIdx !== -1) {
    return pending.slice(0, lastDollarIdx);
  }

  return pending;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
