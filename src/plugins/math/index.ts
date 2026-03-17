/**
 * Math Plugin — KaTeX-powered LaTeX rendering.
 *
 * Supports:
 *   - Inline math:  $E = mc^2$
 *   - Block math:   $$\n...\n$$
 *
 * KaTeX is a peer dependency and is lazily imported on first use.
 * This keeps the core bundle clean even when the math plugin is registered.
 *
 * Usage:
 *   import { createMathPlugin } from 'ai-markdown-renderer/plugins/math';
 *
 *   const renderer = new MarkdownRenderer({
 *     plugins: [createMathPlugin()],
 *   });
 */

import type { Plugin } from '../../core/types.js';

export interface MathPluginOptions {
  /**
   * KaTeX render options forwarded to katex.renderToString().
   * throwOnError defaults to false (renders error in red instead of throwing).
   */
  katexOptions?: {
    throwOnError?: boolean;
    displayMode?: boolean;
    output?: 'html' | 'mathml' | 'htmlAndMathml';
    macros?: Record<string, string>;
    [key: string]: unknown;
  };
}

/**
 * Creates a math rendering plugin using KaTeX.
 * Registers a markdown-it plugin that handles $...$ and $$...$$  syntax.
 */
export function createMathPlugin(options: MathPluginOptions = {}): Plugin {
  const { katexOptions = {} } = options;
  const baseKatexOptions = {
    throwOnError: false,
    ...katexOptions,
  };

  // Lazy KaTeX import — resolved on first render call
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let katex: any = null;

  // Sync helper — safe to call from renderer rules (no await required)
  const syncCheckGlobalKatex = () => {
    if (!katex && typeof globalThis !== 'undefined') {
      const g = (globalThis as Record<string, unknown>)['katex'];
      if (g) katex = g;
    }
  };

  const loadKatex = async () => {
    if (katex) return;
    // Synchronous check FIRST (before any await): if KaTeX is already on the
    // global scope (e.g., loaded via <script src="katex.min.js">), use it
    // immediately. Because async functions run synchronously until the first
    // await, this sets `katex` before any caller's next line executes.
    syncCheckGlobalKatex();
    if (katex) return;
    // Async path: bundler / Node environment
    try {
      const mod = await import('katex');
      katex = mod.default ?? mod;
    } catch {
      // Final fallback in case it loaded while the import was in-flight
      syncCheckGlobalKatex();
    }
  };

  const renderMath = (tex: string, displayMode: boolean): string => {
    if (!katex) {
      // KaTeX not yet loaded — return a placeholder with the raw TeX
      const cls = displayMode ? 'math-block-pending' : 'math-inline-pending';
      return `<span class="${cls}" data-tex="${escapeAttr(tex)}">${escapeHtml(tex)}</span>`;
    }
    try {
      return katex.renderToString(tex, { ...baseKatexOptions, displayMode });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `<span class="katex-error" title="${escapeAttr(msg)}">${escapeHtml(tex)}</span>`;
    }
  };

  const markdownItPlugin = (md: object) => {
    const mdAny = md as {
      core: { ruler: { push: (name: string, fn: (state: object) => void) => void } };
      block: { ruler: { before: (before: string, name: string, fn: (state: object, startLine: number, endLine: number, silent: boolean) => boolean, options?: object) => void } };
      inline: { ruler: { before: (before: string, name: string, fn: (state: object, silent: boolean) => boolean) => void } };
      renderer: { rules: Record<string, (tokens: object[], idx: number) => string> };
    };

    // ---- Inline math: $...$ ----
    mdAny.inline.ruler.before('escape', 'math-inline', (state: object, silent: boolean): boolean => {
      const stateAny = state as {
        src: string;
        pos: number;
        posMax: number;
        push: (type: string, tag: string, nesting: number) => { content: string; markup: string };
      };

      const src = stateAny.src;
      const pos = stateAny.pos;

      if (src[pos] !== '$') return false;
      if (src[pos + 1] === '$') return false; // block math handled elsewhere

      // Find closing $
      let end = pos + 1;
      while (end < stateAny.posMax && src[end] !== '$') {
        if (src[end] === '\\') end++; // escaped char
        end++;
      }

      if (end >= stateAny.posMax || src[end] !== '$') return false;
      if (silent) return true;

      const token = stateAny.push('math-inline', '', 0);
      token.content = src.slice(pos + 1, end);
      token.markup = '$';
      stateAny.pos = end + 1;
      return true;
    });

    // ---- Block math: $$\n...\n$$ ----
    mdAny.block.ruler.before(
      'fence',
      'math-block',
      (state: object, startLine: number, endLine: number, silent: boolean): boolean => {
        const stateAny = state as {
          src: string;
          bMarks: number[];
          eMarks: number[];
          tShift: number[];
          lineMax: number;
          line: number;
          push: (type: string, tag: string, nesting: number) => { content: string; markup: string; map: number[] };
        };

        let pos = stateAny.bMarks[startLine]! + stateAny.tShift[startLine]!;
        const max = stateAny.eMarks[startLine]!;
        const lineText = stateAny.src.slice(pos, max);

        if (!lineText.startsWith('$$')) return false;
        if (silent) return true;

        // Find closing $$
        let nextLine = startLine + 1;
        let found = false;
        while (nextLine < endLine) {
          pos = stateAny.bMarks[nextLine]! + stateAny.tShift[nextLine]!;
          const lineEnd = stateAny.eMarks[nextLine]!;
          if (stateAny.src.slice(pos, lineEnd).trim() === '$$') {
            found = true;
            break;
          }
          nextLine++;
        }

        // Collect content between $$ delimiters
        const contentLines: string[] = [];
        for (let i = startLine + 1; i < nextLine; i++) {
          const lineStart = stateAny.bMarks[i]! + stateAny.tShift[i]!;
          const lineEnd = stateAny.eMarks[i]!;
          contentLines.push(stateAny.src.slice(lineStart, lineEnd));
        }

        // If no closing $$ found, take everything to end (graceful for streaming)
        if (!found) nextLine = endLine;

        const token = stateAny.push('math-block', 'math', 0);
        token.content = contentLines.join('\n');
        token.markup = '$$';
        token.map = [startLine, nextLine + 1];
        stateAny.line = nextLine + (found ? 1 : 0);
        return true;
      },
      { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
    );

    // ---- Renderers ----
    mdAny.renderer.rules['math-inline'] = (tokens: object[], idx: number): string => {
      const token = tokens[idx] as { content: string };
      syncCheckGlobalKatex(); // sync: picks up window.katex before renderMath runs
      void loadKatex();       // async: ensures katex loads for subsequent renders
      return renderMath(token.content, false);
    };

    mdAny.renderer.rules['math-block'] = (tokens: object[], idx: number): string => {
      const token = tokens[idx] as { content: string };
      syncCheckGlobalKatex();
      void loadKatex();
      return '<p>' + renderMath(token.content, true) + '</p>\n';
    };
  };

  return {
    name: 'math',
    markdownItPlugins: [markdownItPlugin],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
