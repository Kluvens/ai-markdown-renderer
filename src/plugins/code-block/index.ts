/**
 * AI-aware Code Block Plugin
 *
 * Replaces the default markdown-it fence renderer with a rich UI that:
 *
 *  1. 自动识别 (Auto-detect) — if no language is declared in the fence,
 *     uses highlight.js highlightAuto() to guess the language from content.
 *
 *  2. 自动高亮 (Auto-highlight) — applies syntax highlighting via highlight.js.
 *     Falls back to plain text if hljs is not available.
 *
 *  3. 自动解释 (Auto-label) — renders a header bar above each code block showing:
 *       • Language badge (e.g. "TypeScript", "Python")
 *       • Line count (e.g. "12 lines")
 *       • Copy button (copies raw code to clipboard)
 *
 * Usage:
 *   import { createCodeBlockPlugin } from 'ai-markdown-renderer/plugins/code-block';
 *
 *   const renderer = new MarkdownRenderer({
 *     plugins: [createCodeBlockPlugin()],
 *   });
 */

import type { Plugin } from '../../core/types.js';

export interface CodeBlockPluginOptions {
  /**
   * Show the language badge in the header.
   * Default: true
   */
  showLanguage?: boolean;
  /**
   * Show the line count in the header.
   * Default: true
   */
  showLineCount?: boolean;
  /**
   * Show the copy button.
   * Default: true
   */
  showCopyButton?: boolean;
  /**
   * Label shown on the copy button before clicking.
   * Default: 'Copy'
   */
  copyLabel?: string;
  /**
   * Label shown after a successful copy.
   * Default: 'Copied!'
   */
  copiedLabel?: string;
  /**
   * CSS class prefix for all generated elements.
   * Default: 'ai-code'
   */
  classPrefix?: string;
}

// Friendly display names for common language identifiers
const LANG_DISPLAY_NAMES: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  jsx: 'JSX',
  py: 'Python',
  python: 'Python',
  rb: 'Ruby',
  ruby: 'Ruby',
  rs: 'Rust',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
  kt: 'Kotlin',
  kotlin: 'Kotlin',
  swift: 'Swift',
  cpp: 'C++',
  'c++': 'C++',
  c: 'C',
  cs: 'C#',
  csharp: 'C#',
  php: 'PHP',
  sh: 'Shell',
  bash: 'Bash',
  zsh: 'Zsh',
  shell: 'Shell',
  sql: 'SQL',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  sass: 'Sass',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  md: 'Markdown',
  markdown: 'Markdown',
  dockerfile: 'Dockerfile',
  graphql: 'GraphQL',
  r: 'R',
  matlab: 'MATLAB',
  lua: 'Lua',
  vim: 'Vim Script',
  tex: 'LaTeX',
};

function displayName(lang: string): string {
  return LANG_DISPLAY_NAMES[lang.toLowerCase()] ?? lang;
}

export function createCodeBlockPlugin(options: CodeBlockPluginOptions = {}): Plugin {
  const {
    showLanguage = true,
    showLineCount = true,
    showCopyButton = true,
    copyLabel = 'Copy',
    copiedLabel = 'Copied!',
    classPrefix = 'ai-code',
  } = options;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let hljs: any = null;
  let hljsLoading = false;

  const syncCheckGlobalHljs = () => {
    if (!hljs && typeof globalThis !== 'undefined') {
      const g = (globalThis as Record<string, unknown>)['hljs'];
      if (g) hljs = g;
    }
  };

  const loadHljs = async () => {
    if (hljs || hljsLoading) return;
    // Sync check first (no await) — picks up window.hljs from CDN script
    syncCheckGlobalHljs();
    if (hljs) return;
    hljsLoading = true;
    try {
      const mod = await import('highlight.js');
      hljs = mod.default ?? mod;
    } catch {
      // highlight.js not installed — fall back to window.hljs or plain text
      syncCheckGlobalHljs();
    }
    hljsLoading = false;
  };

  // Synchronous highlight: returns highlighted HTML or null
  function highlightCode(code: string, lang: string): { html: string; detectedLang: string } {
    syncCheckGlobalHljs(); // pick up window.hljs if available
    if (!hljs) {
      void loadHljs(); // kick off async load for next render
      return { html: escapeHtml(code), detectedLang: lang };
    }

    // If language is specified and known, use it
    if (lang && hljs.getLanguage(lang)) {
      try {
        const result = hljs.highlight(code, { language: lang, ignoreIllegals: true });
        return { html: result.value, detectedLang: lang };
      } catch {
        // fall through to auto-detect
      }
    }

    // Auto-detect: 自动识别 (Auto-detect language)
    try {
      const result = hljs.highlightAuto(code);
      return {
        html: result.value,
        detectedLang: result.language ?? lang ?? '',
      };
    } catch {
      return { html: escapeHtml(code), detectedLang: lang };
    }
  }

  const markdownItPlugin = (md: object) => {
    const mdAny = md as {
      renderer: {
        rules: Record<string, (tokens: object[], idx: number, options: object, env: object, self: object) => string>;
        renderToken: (tokens: object[], idx: number, options: object) => string;
      };
    };

    mdAny.renderer.rules['fence'] = (tokens, idx) => {
      const token = tokens[idx] as { info: string; content: string };
      const rawLang = token.info.trim().split(/\s+/)[0] ?? '';
      const code = token.content;
      const lineCount = code.split('\n').filter((_, i, arr) => i < arr.length - 1 || arr[i] !== '').length;

      // 自动高亮 + 自动识别
      const { html: highlightedHtml, detectedLang } = highlightCode(code, rawLang);
      const langLabel = detectedLang ? displayName(detectedLang) : 'code';

      // Build header items
      const headerParts: string[] = [];

      if (showLanguage) {
        headerParts.push(
          `<span class="${classPrefix}-lang">${escapeHtml(langLabel)}</span>`,
        );
      }

      if (showLineCount && lineCount > 0) {
        headerParts.push(
          `<span class="${classPrefix}-lines">${lineCount} line${lineCount === 1 ? '' : 's'}</span>`,
        );
      }

      if (showCopyButton) {
        // Inline onclick: copies raw code. Uses data-code attribute to avoid
        // escaping issues in the onclick attribute itself.
        headerParts.push(
          `<button class="${classPrefix}-copy" data-code="${escapeAttr(code)}" ` +
          `onclick="(function(b){navigator.clipboard.writeText(b.dataset.code).then(function(){` +
          `var orig=b.textContent;b.textContent='${copiedLabel}';` +
          `setTimeout(function(){b.textContent=orig},2000)})` +
          `})(this)">${copyLabel}</button>`,
        );
      }

      const header = headerParts.length > 0
        ? `<div class="${classPrefix}-header">${headerParts.join('')}</div>`
        : '';

      const langClass = detectedLang ? ` class="hljs language-${escapeAttr(detectedLang)}"` : ' class="hljs"';

      return (
        `<div class="${classPrefix}-block">` +
        header +
        `<pre><code${langClass}>${highlightedHtml}</code></pre>` +
        `</div>\n`
      );
    };
  };

  // Pre-load hljs eagerly so the first code block is highlighted immediately
  void loadHljs();

  return {
    name: 'code-block',
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
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
