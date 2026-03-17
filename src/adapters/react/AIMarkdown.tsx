/**
 * AIMarkdown — the simplest way to render AI markdown in React.
 *
 * Works for both static content and live streaming. All internal
 * rendering complexity (committed / speculative zones, DOM injection)
 * is hidden behind a single component.
 *
 * @example
 * // Static — children
 * <AIMarkdown>{markdownText}</AIMarkdown>
 *
 * // Static — prop
 * <AIMarkdown content={markdownText} />
 *
 * // Streaming (AsyncIterable<string> from any LLM SDK)
 * <AIMarkdown stream={openaiStream} />
 *
 * // With customization
 * <AIMarkdown
 *   content={text}
 *   className="ai-markdown my-prose"
 *   plugins={[createThinkingPlugin(), createMathPlugin()]}
 *   onComplete={(html) => save(html)}
 * />
 */

import React, { useMemo } from 'react';
import { MarkdownRenderer } from '../../core/renderer.js';
import type { Plugin, RendererOptions } from '../../core/types.js';
import { MarkdownStream } from './MarkdownStream.js';

export interface AIMarkdownProps {
  /**
   * Static markdown as JSX children.
   * Ignored when `stream` is provided.
   */
  children?: string;
  /**
   * Static markdown as a prop. Takes precedence over `children`.
   * Ignored when `stream` is provided.
   */
  content?: string;
  /**
   * Async iterable of text chunks for streaming content (e.g. an OpenAI
   * or Anthropic SSE stream). When provided, `content` / `children` are
   * ignored and the component drives the stream automatically.
   */
  stream?: AsyncIterable<string>;
  /** CSS class(es) applied to the outer wrapper `<div>`. */
  className?: string;
  /** Inline styles on the outer wrapper `<div>`. */
  style?: React.CSSProperties;
  /** Plugins to enable (math, syntax highlight, thinking, code-block, …). */
  plugins?: Plugin[];
  /** Options forwarded directly to markdown-it. */
  markdownItOptions?: RendererOptions['markdownItOptions'];
  /**
   * Called when streaming completes. Receives the full rendered HTML string.
   * Not called for static rendering.
   */
  onComplete?: (html: string) => void;
  /** Called if an error occurs while consuming the stream. */
  onError?: (err: Error) => void;
}

export const AIMarkdown: React.FC<AIMarkdownProps> = ({
  children,
  content,
  stream,
  className,
  style,
  plugins,
  markdownItOptions,
  onComplete,
  onError,
}) => {
  // ---- Streaming mode ----
  if (stream) {
    // Build props object conditionally to satisfy exactOptionalPropertyTypes
    const streamProps: Parameters<typeof MarkdownStream>[0] = { stream };
    if (className !== undefined) streamProps.className = className;
    if (style !== undefined) streamProps.style = style;
    if (plugins !== undefined) streamProps.plugins = plugins;
    if (markdownItOptions !== undefined) streamProps.markdownItOptions = markdownItOptions;
    if (onComplete !== undefined) streamProps.onComplete = onComplete;
    if (onError !== undefined) streamProps.onError = onError;
    return <MarkdownStream {...streamProps} />;
  }

  // ---- Static mode ----
  const md = content ?? children ?? '';
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const html = useMemo(() => {
    const opts: import('../../core/types.js').RendererOptions = {};
    if (plugins !== undefined) opts.plugins = plugins;
    if (markdownItOptions !== undefined) opts.markdownItOptions = markdownItOptions;
    return MarkdownRenderer.render(md, opts);
    // Plugins array identity determines re-render; users should memoize if needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [md, plugins, markdownItOptions]);

  return (
    <div
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

AIMarkdown.displayName = 'AIMarkdown';
