/**
 * useMarkdownStream — React hook for AI streaming markdown.
 *
 * Two-zone rendering strategy:
 *   - committedRef: a ref to a DOM element. Committed HTML is injected via
 *     `element.innerHTML +=` — bypassing React's reconciler entirely.
 *     This means React never re-renders the stable, committed content.
 *   - speculativeHtml: React state. Only the current partial trailing block
 *     goes through React. This is the only thing that causes re-renders.
 *
 * Result: for a 10KB streamed response, React reconciles ~200 chars per token
 * instead of 10KB. Typically 20-50x fewer reconciler operations.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownRenderer } from '../../core/renderer.js';
import type { RendererOptions, RenderDelta } from '../../core/types.js';

export interface UseMarkdownStreamOptions extends RendererOptions {
  /**
   * Throttle React state updates to at most once per N milliseconds.
   * Useful to cap re-renders when tokens arrive very fast (e.g., local models).
   * Default: 0 (update on every delta event)
   */
  renderThrottle?: number;
}

export interface UseMarkdownStreamReturn {
  /** Ref to attach to a container element. Committed HTML is injected here. */
  committedRef: React.RefObject<HTMLDivElement | null>;
  /** The current speculative trailing HTML (the partial in-progress block). */
  speculativeHtml: string;
  /** Push a new text chunk from the LLM stream. */
  push: (chunk: string) => void;
  /** Signal end of stream. */
  flush: () => void;
  /** Reset for a new stream. Clears DOM and resets state. */
  reset: () => void;
  /** True while the stream is active (between first push and flush). */
  isStreaming: boolean;
}

export function useMarkdownStream(
  options: UseMarkdownStreamOptions = {},
): UseMarkdownStreamReturn {
  const { renderThrottle = 0, ...rendererOptions } = options;

  // Stable renderer instance across renders
  const rendererRef = useRef<MarkdownRenderer | null>(null);
  if (rendererRef.current === null) {
    rendererRef.current = new MarkdownRenderer(rendererOptions);
  }

  const committedRef = useRef<HTMLDivElement | null>(null);
  const [speculativeHtml, setSpeculativeHtml] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // Throttle helpers
  const throttleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSpeculative = useRef<string>('');

  const applyDelta = useCallback((delta: RenderDelta) => {
    // Committed HTML: inject directly into DOM, bypassing React
    if (delta.appendHtml && committedRef.current) {
      committedRef.current.innerHTML += delta.appendHtml;
    }

    // Speculative HTML: update React state (with optional throttle)
    if (renderThrottle <= 0) {
      setSpeculativeHtml(delta.speculativeHtml);
    } else {
      pendingSpeculative.current = delta.speculativeHtml;
      if (throttleTimer.current === null) {
        throttleTimer.current = setTimeout(() => {
          throttleTimer.current = null;
          setSpeculativeHtml(pendingSpeculative.current);
        }, renderThrottle);
      }
    }
  }, [renderThrottle]);

  // Wire up renderer events
  useEffect(() => {
    const renderer = rendererRef.current!;

    const onDelta = (delta: RenderDelta) => {
      applyDelta(delta);
    };

    const onFlush = () => {
      // Clear any pending throttle
      if (throttleTimer.current !== null) {
        clearTimeout(throttleTimer.current);
        throttleTimer.current = null;
      }
      setSpeculativeHtml('');
      setIsStreaming(false);
    };

    renderer.on('delta', onDelta);
    renderer.on('flush', onFlush);

    return () => {
      renderer.off('delta', onDelta);
      renderer.off('flush', onFlush);
    };
  }, [applyDelta]);

  const push = useCallback((chunk: string) => {
    setIsStreaming(true);
    rendererRef.current!.push(chunk);
  }, []);

  const flush = useCallback(() => {
    rendererRef.current!.flush();
  }, []);

  const reset = useCallback(() => {
    // Clear throttle
    if (throttleTimer.current !== null) {
      clearTimeout(throttleTimer.current);
      throttleTimer.current = null;
    }
    // Clear DOM
    if (committedRef.current) {
      committedRef.current.innerHTML = '';
    }
    // Reset React state
    setSpeculativeHtml('');
    setIsStreaming(false);
    // Reset renderer
    rendererRef.current!.reset();
  }, []);

  return {
    committedRef,
    speculativeHtml,
    push,
    flush,
    reset,
    isStreaming,
  };
}
