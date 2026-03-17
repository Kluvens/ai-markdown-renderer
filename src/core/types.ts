/**
 * All public and internal types for ai-markdown-renderer.
 * Every other module imports from here.
 */

// ---------------------------------------------------------------------------
// Block parser state machine
// ---------------------------------------------------------------------------

export type BlockMode =
  | 'normal'       // between blocks, scanning for next construct
  | 'paragraph'    // inside a paragraph (plain text block)
  | 'atx-heading'  // # heading (single-line, auto-committed on newline)
  | 'code-fence'   // inside ``` ... ``` or ~~~ ... ~~~
  | 'math-block'   // inside $$ ... $$
  | 'blockquote'   // inside > ... lines
  | 'list'         // inside - / * / 1. list
  | 'table'        // inside GFM table (| col | col |)
  | 'think-block'; // inside <think> ... </think> (reasoning from Claude, DeepSeek, etc.)

export interface CodeFenceMeta {
  lang: string;
  char: '`' | '~';
  length: number; // fence width (3+)
}

export interface ParseState {
  mode: BlockMode;
  /** Raw text of the current in-progress (speculative) block. */
  speculativeBuffer: string;
  /** Append-only array of committed HTML strings. Never mutated after push. */
  committedHtmlParts: string[];
  /** Set when mode === 'code-fence'. */
  codeFenceMeta: CodeFenceMeta | null;
  /** Nesting depth for blockquotes / lists. */
  nestingDepth: number;
  /** Monotonically increasing; increments on each commit. */
  version: number;
}

// ---------------------------------------------------------------------------
// Render output
// ---------------------------------------------------------------------------

/**
 * Emitted on every `push()` call after new content is processed.
 * - `appendHtml`: newly committed HTML — append this to the DOM once.
 * - `speculativeHtml`: current trailing partial-block HTML — replace each time.
 * - `version`: monotonically increasing for ordering / reconciliation.
 */
export interface RenderDelta {
  appendHtml: string;
  speculativeHtml: string;
  version: number;
}

// ---------------------------------------------------------------------------
// Plugin system
// ---------------------------------------------------------------------------

/**
 * A plugin can:
 * 1. Hook into the rendering pipeline via `hooks`
 * 2. Register markdown-it plugins via `markdownItPlugins`
 */
export interface Plugin {
  name: string;
  hooks?: PluginHooks;
  /**
   * Array of markdown-it plugin functions. Each receives the MarkdownIt instance
   * and may mutate it (add rules, etc.). Called once during renderer construction.
   */
  markdownItPlugins?: Array<(md: object) => void>;
}

export interface PluginHooks {
  /**
   * Called with the raw block text just before it is passed to markdown-it.
   * Return a (possibly transformed) string.
   */
  'before-commit'?: (rawBlock: string, state: Readonly<ParseState>) => string;
  /**
   * Called with the rendered HTML string for a block and the original raw text.
   * Return a (possibly transformed) HTML string.
   */
  'after-render'?: (html: string, rawBlock: string) => string;
  /**
   * Called once when `flush()` is invoked, after all blocks are committed.
   */
  'on-flush'?: () => void;
}

// ---------------------------------------------------------------------------
// Renderer options
// ---------------------------------------------------------------------------

export interface RendererOptions {
  /** Plugins to apply. Order matters — hooks run in registration order. */
  plugins?: Plugin[];
  /**
   * If the speculative buffer exceeds this many bytes, force-commit with
   * graceful degradation (auto-close unclosed code fences, etc.).
   * Default: 8192
   */
  speculativeBufferLimit?: number;
  /**
   * Debounce delta events in milliseconds.
   * Default: 0 (synchronous — emit on every push)
   */
  debounce?: number;
  /**
   * Options forwarded to the markdown-it constructor.
   * html: true is set by default if not overridden.
   */
  markdownItOptions?: {
    html?: boolean;
    xhtmlOut?: boolean;
    breaks?: boolean;
    langPrefix?: string;
    linkify?: boolean;
    typographer?: boolean;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Syntax highlight plugin types (exported for adapter authors)
// ---------------------------------------------------------------------------

export interface HighlightAdapter {
  /**
   * Highlight `code` for the given `lang`.
   * May return a Promise for async highlighters (e.g., Shiki).
   * Return null/undefined to fall back to plain text.
   */
  highlight(code: string, lang: string): string | null | Promise<string | null>;
  /** Called once when the plugin is registered. Use for lazy loading. */
  load?(): Promise<void>;
}
