/**
 * MarkdownStream — React component for AI streaming markdown.
 *
 * Accepts either:
 *   - `stream`: an AsyncIterable<string> (auto-drives push/flush)
 *   - Manual control via push/flush refs (use useMarkdownStream directly)
 *
 * Usage:
 *   <MarkdownStream stream={llmStream} className="prose" />
 */

import React, { useEffect } from 'react';
import { useMarkdownStream, type UseMarkdownStreamOptions } from './useMarkdownStream.js';

export interface MarkdownStreamProps extends UseMarkdownStreamOptions {
  /** An async iterable of text chunks (e.g., from OpenAI streaming). */
  stream?: AsyncIterable<string>;
  /** Class applied to the outer container. */
  className?: string;
  /** Inline styles on the outer container. */
  style?: React.CSSProperties;
  /** Class applied to the committed (stable) content zone. */
  committedClassName?: string;
  /** Class applied to the speculative (in-progress) content zone. */
  speculativeClassName?: string;
  /** Called when the stream completes with the final rendered HTML. */
  onComplete?: (html: string) => void;
  /** Called on render errors. */
  onError?: (err: Error) => void;
}

export const MarkdownStream: React.FC<MarkdownStreamProps> = ({
  stream,
  className,
  style,
  committedClassName,
  speculativeClassName,
  onComplete,
  onError,
  // renderer options (rest)
  plugins,
  speculativeBufferLimit,
  debounce,
  markdownItOptions,
  renderThrottle,
}) => {
  const hookOpts: UseMarkdownStreamOptions = {};
  if (plugins !== undefined) hookOpts.plugins = plugins;
  if (speculativeBufferLimit !== undefined) hookOpts.speculativeBufferLimit = speculativeBufferLimit;
  if (debounce !== undefined) hookOpts.debounce = debounce;
  if (markdownItOptions !== undefined) hookOpts.markdownItOptions = markdownItOptions;
  if (renderThrottle !== undefined) hookOpts.renderThrottle = renderThrottle;

  const { committedRef, speculativeHtml, push, flush, reset, isStreaming } = useMarkdownStream(hookOpts);

  // Wire up the stream prop
  useEffect(() => {
    if (!stream) return;

    reset();
    let cancelled = false;

    const run = async () => {
      try {
        for await (const chunk of stream) {
          if (cancelled) break;
          push(chunk);
        }
        if (!cancelled) {
          flush();
        }
      } catch (err) {
        if (!cancelled) {
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  // Call onComplete when streaming ends
  useEffect(() => {
    if (!isStreaming && onComplete && committedRef.current) {
      const html = committedRef.current.innerHTML;
      if (html) onComplete(html);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  return (
    <div className={className} style={style}>
      {/* Committed zone: stable, injected via innerHTML, no React reconciliation */}
      <div ref={committedRef as React.RefObject<HTMLDivElement>} className={committedClassName} />
      {/* Speculative zone: only the current partial block goes through React */}
      {speculativeHtml && (
        <div
          className={speculativeClassName}
          dangerouslySetInnerHTML={{ __html: speculativeHtml }}
        />
      )}
    </div>
  );
};

MarkdownStream.displayName = 'MarkdownStream';
