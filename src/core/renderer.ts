/**
 * MarkdownRenderer — the main public API.
 *
 * Wires together:
 *   StreamingBlockSplitter → committed blocks → markdown-it → plugin hooks → RenderDelta events
 *   SpeculativeRenderer    → speculative tail  → markdown-it → speculativeHtml in RenderDelta
 */

import MarkdownIt from 'markdown-it';
import { StreamingBlockSplitter } from './streaming-block-splitter.js';
import { SpeculativeRenderer } from './speculative-renderer.js';
import type { Plugin, RenderDelta, RendererOptions, ParseState } from './types.js';

type EventMap = {
  delta: (delta: RenderDelta) => void;
  flush: (finalHtml: string) => void;
  error: (err: Error) => void;
};

type Listener<K extends keyof EventMap> = EventMap[K];

export class MarkdownRenderer {
  private readonly md: MarkdownIt;
  private readonly plugins: Plugin[];
  private readonly speculativeRenderer: SpeculativeRenderer;
  private splitter: StreamingBlockSplitter;
  private readonly listeners: { [K in keyof EventMap]?: Set<Listener<K>> } = {};
  private debounceMs: number;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDelta: RenderDelta | null = null;

  constructor(options: RendererOptions = {}) {
    const {
      plugins = [],
      speculativeBufferLimit = 8192,
      debounce = 0,
      markdownItOptions = {},
    } = options;

    this.plugins = plugins;
    this.debounceMs = debounce;

    // Build markdown-it instance
    this.md = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: false,
      ...markdownItOptions,
    });

    // Register markdown-it plugins
    for (const plugin of plugins) {
      if (plugin.markdownItPlugins) {
        for (const mdPlugin of plugin.markdownItPlugins) {
          mdPlugin(this.md as object);
        }
      }
    }

    this.speculativeRenderer = new SpeculativeRenderer(this.md, plugins);

    this.splitter = new StreamingBlockSplitter(
      (rawBlock) => this.onBlockCommitted(rawBlock),
      speculativeBufferLimit,
    );
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Feed a new chunk of text from the LLM stream.
   * Emits a 'delta' event with newly committed HTML and the current speculative tail.
   */
  push(chunk: string): void {
    try {
      const versionBefore = this.splitter.currentState.version;
      this.splitter.push(chunk);
      const versionAfter = this.splitter.currentState.version;

      // Build speculative HTML for the trailing partial block
      const speculativeHtml = this.speculativeRenderer.render(
        this.splitter,
        this.splitter.currentState,
      );

      // appendHtml is accumulated in onBlockCommitted; collect it
      const appendHtml = this.drainAppendBuffer();

      const delta: RenderDelta = {
        appendHtml,
        speculativeHtml,
        version: versionAfter,
      };

      if (versionBefore !== versionAfter || appendHtml || speculativeHtml !== this.lastSpeculativeHtml) {
        this.lastSpeculativeHtml = speculativeHtml;
        this.emitDelta(delta);
      }
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Signal end of stream. Commits all remaining speculative content.
   * Emits final 'delta' then 'flush' with the complete HTML.
   */
  flush(): void {
    try {
      // Run on-flush plugin hooks
      for (const plugin of this.plugins) {
        plugin.hooks?.['on-flush']?.();
      }

      this.splitter.flush();
      const appendHtml = this.drainAppendBuffer();

      if (appendHtml) {
        const delta: RenderDelta = {
          appendHtml,
          speculativeHtml: '',
          version: this.splitter.currentState.version,
        };
        this.lastSpeculativeHtml = '';
        this.emitDelta(delta);
      }

      // Flush any debounced delta immediately
      if (this.debounceTimer !== null) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
        if (this.pendingDelta) {
          this.emit('delta', this.pendingDelta);
          this.pendingDelta = null;
        }
      }

      this.emit('flush', this.currentHtml);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Reset to initial state. Reuse this instance for a new stream.
   */
  reset(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingDelta = null;
    this.lastSpeculativeHtml = '';
    this.appendBuffer = '';
    this.splitter.reset();
  }

  /**
   * The full current HTML: committed parts joined + speculative tail.
   */
  get currentHtml(): string {
    const committed = this.splitter.currentState.committedHtmlParts.join('');
    const speculative = this.speculativeRenderer.render(
      this.splitter,
      this.splitter.currentState,
    );
    return committed + speculative;
  }

  /**
   * Only the speculative trailing partial-block HTML.
   */
  get speculativeHtml(): string {
    return this.speculativeRenderer.render(this.splitter, this.splitter.currentState);
  }

  // ---------------------------------------------------------------------------
  // Static convenience
  // ---------------------------------------------------------------------------

  /**
   * One-shot synchronous render of a complete markdown string.
   */
  static render(markdown: string, options: RendererOptions = {}): string {
    const renderer = new MarkdownRenderer(options);
    renderer.push(markdown);
    renderer.flush();
    return renderer.currentHtml;
  }

  // ---------------------------------------------------------------------------
  // Event emitter (typed, no external dep)
  // ---------------------------------------------------------------------------

  on<K extends keyof EventMap>(event: K, listener: Listener<K>): this {
    if (!this.listeners[event]) {
      (this.listeners as Record<string, Set<unknown>>)[event] = new Set();
    }
    (this.listeners[event] as Set<Listener<K>>).add(listener);
    return this;
  }

  off<K extends keyof EventMap>(event: K, listener: Listener<K>): this {
    (this.listeners[event] as Set<Listener<K>> | undefined)?.delete(listener);
    return this;
  }

  private emit<K extends keyof EventMap>(event: K, ...args: Parameters<EventMap[K]>): void {
    const set = this.listeners[event] as Set<Listener<K>> | undefined;
    if (set) {
      for (const listener of set) {
        (listener as (...a: Parameters<EventMap[K]>) => void)(...args);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private internals
  // ---------------------------------------------------------------------------

  private appendBuffer = '';
  private lastSpeculativeHtml = '';

  /**
   * Called by StreamingBlockSplitter when a block is committed.
   * Renders it via markdown-it and appends to the committed parts array.
   */
  private onBlockCommitted(rawBlock: string): void {
    let processed = rawBlock;

    // before-commit hooks
    for (const plugin of this.plugins) {
      if (plugin.hooks?.['before-commit']) {
        processed = plugin.hooks['before-commit'](processed, this.splitter.currentState);
      }
    }

    let html = this.md.render(processed);

    // after-render hooks
    for (const plugin of this.plugins) {
      if (plugin.hooks?.['after-render']) {
        html = plugin.hooks['after-render'](html, processed);
      }
    }

    this.splitter.currentState.committedHtmlParts.push(html);
    this.appendBuffer += html;
  }

  private drainAppendBuffer(): string {
    const result = this.appendBuffer;
    this.appendBuffer = '';
    return result;
  }

  private emitDelta(delta: RenderDelta): void {
    if (this.debounceMs <= 0) {
      this.emit('delta', delta);
      return;
    }

    // Accumulate: merge appendHtml, take latest speculativeHtml
    if (this.pendingDelta) {
      this.pendingDelta = {
        appendHtml: this.pendingDelta.appendHtml + delta.appendHtml,
        speculativeHtml: delta.speculativeHtml,
        version: delta.version,
      };
    } else {
      this.pendingDelta = { ...delta };
    }

    if (this.debounceTimer === null) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        if (this.pendingDelta) {
          this.emit('delta', this.pendingDelta);
          this.pendingDelta = null;
        }
      }, this.debounceMs);
    }
  }
}
