/**
 * Syntax Highlight Plugin
 *
 * Plugs into markdown-it's code block rendering to apply syntax highlighting.
 * Uses an adapter pattern so you can choose your highlighter:
 *   - 'highlight-js': synchronous, ~30KB, good for most use cases
 *   - 'shiki':        async, ~150KB+, best quality (VS Code-quality themes)
 *   - Custom:         implement the HighlightAdapter interface
 *
 * Usage:
 *   import { createSyntaxHighlightPlugin } from 'ai-markdown-renderer/plugins/syntax-highlight';
 *   import { createHighlightJsAdapter } from 'ai-markdown-renderer/plugins/syntax-highlight';
 *
 *   const renderer = new MarkdownRenderer({
 *     plugins: [createSyntaxHighlightPlugin({ adapter: createHighlightJsAdapter() })],
 *   });
 */

import type { Plugin, HighlightAdapter } from '../../core/types.js';

export interface SyntaxHighlightOptions {
  adapter: HighlightAdapter | 'highlight-js' | 'shiki';
  /**
   * CSS class applied to code blocks while async highlighting is in flight.
   * Default: 'hljs-pending'
   */
  pendingClass?: string;
  /**
   * CSS class applied to code blocks when the language is unknown/unsupported.
   * Default: 'hljs-plain'
   */
  unknownClass?: string;
}

/**
 * Creates a syntax highlighting plugin.
 */
export function createSyntaxHighlightPlugin(options: SyntaxHighlightOptions): Plugin {
  const { pendingClass = 'hljs-pending', unknownClass = 'hljs-plain' } = options;
  let adapter: HighlightAdapter;

  // Intercept code blocks via markdown-it's highlight option
  // We do this by registering a markdownItPlugin that replaces the highlight fn.
  const markdownItPlugin = (md: object) => {
    const mdAny = md as {
      options: { highlight?: (code: string, lang: string) => string };
    };

    // Resolve adapter lazily on first highlight call
    const getAdapter = (): HighlightAdapter => {
      if (adapter) return adapter;
      if (typeof options.adapter === 'string') {
        throw new Error(
          `[ai-markdown-renderer] Adapter '${options.adapter}' must be created with its factory function. ` +
          `Use createHighlightJsAdapter() or createShikiAdapter().`,
        );
      }
      adapter = options.adapter;
      return adapter;
    };

    mdAny.options.highlight = (code: string, lang: string): string => {
      const resolvedAdapter = getAdapter();
      const result = resolvedAdapter.highlight(code, lang);

      if (typeof result === 'string') {
        // Synchronous result
        return result || wrapPlain(code, unknownClass);
      }

      if (result && typeof (result as Promise<string | null>).then === 'function') {
        // Async result — return placeholder and resolve asynchronously
        // The placeholder has a data attribute so consumers can post-process it
        const placeholder = wrapPending(code, lang, pendingClass);
        // Fire-and-forget; the adapter should update the DOM externally
        // For SSR / non-DOM contexts this is a no-op
        void (result as Promise<string | null>).then(() => {
          // DOM patching is the responsibility of the framework adapter.
          // This plugin intentionally does NOT touch the DOM directly.
        });
        return placeholder;
      }

      return wrapPlain(code, unknownClass);
    };
  };

  return {
    name: 'syntax-highlight',
    markdownItPlugins: [markdownItPlugin],
  };
}

// ---------------------------------------------------------------------------
// Built-in adapters
// ---------------------------------------------------------------------------

/**
 * Creates a synchronous highlight.js adapter.
 * Requires highlight.js to be installed as a peer dependency.
 */
export function createHighlightJsAdapter(): HighlightAdapter {
  let hljs: typeof import('highlight.js').default | null = null;

  const load = async () => {
    const mod = await import('highlight.js');
    hljs = mod.default;
  };

  return {
    load,
    highlight(code: string, lang: string): string | null {
      if (!hljs) return null;
      if (lang && hljs.getLanguage(lang)) {
        try {
          const result = hljs.highlight(code, { language: lang, ignoreIllegals: true });
          return `<pre><code class="hljs language-${lang}">${result.value}</code></pre>`;
        } catch {
          // fall through
        }
      }
      // Auto-detect
      try {
        const result = hljs.highlightAuto(code);
        return `<pre><code class="hljs">${result.value}</code></pre>`;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Creates an async Shiki adapter.
 * Requires shiki to be installed as a peer dependency.
 *
 * @param theme - Shiki theme name (default: 'github-dark')
 * @param langs - Languages to pre-load (default: common set)
 */
export function createShikiAdapter(options: {
  theme?: string;
  langs?: string[];
} = {}): HighlightAdapter {
  const { theme = 'github-dark', langs } = options;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let highlighter: any = null;

  const load = async () => {
    // shiki is an optional peer dep; dynamic import avoids bundling it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { createHighlighter } = await import('shiki' as any);
    highlighter = await createHighlighter({
      themes: [theme],
      langs: langs ?? ['typescript', 'javascript', 'python', 'bash', 'json', 'markdown', 'rust', 'go'],
    });
  };

  return {
    load,
    async highlight(code: string, lang: string): Promise<string | null> {
      if (!highlighter) await load();
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        return (highlighter as { codeToHtml: (code: string, opts: object) => string }).codeToHtml(code, { lang: lang || 'text', theme });
      } catch {
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapPlain(code: string, cssClass: string): string {
  return `<pre><code class="${cssClass}">${escapeHtml(code)}</code></pre>`;
}

function wrapPending(code: string, lang: string, pendingClass: string): string {
  return `<pre data-lang="${lang}" data-highlight-pending="true"><code class="${pendingClass}">${escapeHtml(code)}</code></pre>`;
}
