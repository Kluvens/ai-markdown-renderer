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
 * // Streaming
 * <AIMarkdown stream={openaiStream} />
 *
 * // Custom components (like react-markdown)
 * <AIMarkdown
 *   content={text}
 *   components={{
 *     h1: ({ children }) => <h1 className="text-3xl font-bold">{children}</h1>,
 *     p:  ({ children }) => <p className="my-2 text-gray-200">{children}</p>,
 *     code: ({ className, children }) => {
 *       const lang = /language-(\w+)/.exec(className ?? '')?.[1];
 *       return lang ? <CodeBlock lang={lang}>{children}</CodeBlock>
 *                   : <code className="bg-zinc-700 px-1 rounded">{children}</code>;
 *     },
 *   }}
 * />
 */

import React, { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import parse, { domToReact, attributesToProps, Element as DOMElement } from 'html-react-parser';
import type { DOMNode, HTMLReactParserOptions } from 'html-react-parser';
import { MarkdownRenderer } from '../../core/renderer.js';
import type { Plugin, RendererOptions } from '../../core/types.js';
import { MarkdownStream } from './MarkdownStream.js';

// ---------------------------------------------------------------------------
// Components map type — mirrors react-markdown's API
// ---------------------------------------------------------------------------

/**
 * Map of HTML tag names to custom React components.
 * Each component receives the same props as the native element would,
 * plus `children` already converted to React nodes.
 *
 * @example
 * const components: MarkdownComponents = {
 *   h1: ({ children }) => <h1 className="text-4xl">{children}</h1>,
 *   a: ({ href, children }) => <a href={href} target="_blank">{children}</a>,
 *   code: ({ className, children }) => {
 *     const lang = /language-(\w+)/.exec(className ?? '')?.[1];
 *     return lang ? <SyntaxBlock lang={lang}>{children}</SyntaxBlock>
 *                 : <code>{children}</code>;
 *   },
 * };
 */
export type MarkdownComponents = {
  [K in keyof React.JSX.IntrinsicElements]?: React.ComponentType<
    React.ComponentPropsWithoutRef<K> & { children?: React.ReactNode }
  >;
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AIMarkdownProps {
  /** Static markdown as JSX children. Ignored when `stream` is provided. */
  children?: string;
  /** Static markdown as a prop. Takes precedence over `children`. Ignored when `stream` is provided. */
  content?: string;
  /** Async iterable of text chunks (e.g. OpenAI / Anthropic streaming response). */
  stream?: AsyncIterable<string>;
  /** CSS class(es) on the outer wrapper `<div>`. */
  className?: string;
  /** Inline styles on the outer wrapper `<div>`. */
  style?: React.CSSProperties;
  /** Plugins to enable (math, syntax highlight, thinking, code-block, …). */
  plugins?: Plugin[];
  /** Options forwarded directly to markdown-it. */
  markdownItOptions?: RendererOptions['markdownItOptions'];
  /**
   * Custom React components to replace HTML elements.
   * Works the same as react-markdown's `components` prop.
   * When provided, the HTML is parsed into a React tree instead of being
   * injected via innerHTML — enables full React rendering for every element.
   */
  components?: MarkdownComponents;
  /** Called when streaming completes. Receives the final rendered HTML. */
  onComplete?: (html: string) => void;
  /** Called if an error occurs while consuming the stream. */
  onError?: (err: Error) => void;
}

// ---------------------------------------------------------------------------
// HTML → React elements with custom component substitution
// ---------------------------------------------------------------------------

function makeParserOptions(components: MarkdownComponents): HTMLReactParserOptions {
  function replace(domNode: DOMNode): React.ReactElement | undefined {
    if (!(domNode instanceof DOMElement)) return undefined;
    const tag = domNode.name as keyof React.JSX.IntrinsicElements;
    const Comp = components[tag] as React.ComponentType<Record<string, unknown>> | undefined;
    if (!Comp) return undefined;

    const props: Record<string, unknown> = attributesToProps(domNode.attribs);
    if (domNode.children.length > 0) {
      props.children = domToReact(domNode.children as DOMNode[], { replace });
    }
    return React.createElement(Comp, props);
  }
  return { replace };
}

function renderHtml(html: string, components: MarkdownComponents): React.ReactNode {
  return parse(html, makeParserOptions(components));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AIMarkdown: React.FC<AIMarkdownProps> = ({
  children,
  content,
  stream,
  className,
  style,
  plugins,
  markdownItOptions,
  components,
  onComplete,
  onError,
}) => {
  // ── Streaming + components ─────────────────────────────────────────────
  // When custom components are provided we can't use the innerHTML+= fast
  // path; we need React to own every node. We drive the renderer directly
  // and keep committed blocks in state as an array so React only creates
  // new DOM nodes for newly-committed blocks (existing ones are stable).
  const streamWithComponents = stream && components;

  const [committedParts, setCommittedParts] = useState<string[]>([]);
  const [speculativeHtml, setSpeculativeHtml] = useState('');
  const rendererRef = useRef<MarkdownRenderer | null>(null);

  useEffect(() => {
    if (!streamWithComponents) return;

    setCommittedParts([]);
    setSpeculativeHtml('');

    const opts: RendererOptions = {};
    if (plugins !== undefined) opts.plugins = plugins;
    if (markdownItOptions !== undefined) opts.markdownItOptions = markdownItOptions;

    const renderer = new MarkdownRenderer(opts);
    rendererRef.current = renderer;

    renderer.on('delta', ({ appendHtml, speculativeHtml: spec }) => {
      if (appendHtml) setCommittedParts((prev) => [...prev, appendHtml]);
      setSpeculativeHtml(spec);
    });

    renderer.on('flush', () => {
      setSpeculativeHtml('');
      if (onComplete) {
        const full = (rendererRef.current?.currentHtml) ?? '';
        onComplete(full);
      }
    });

    let cancelled = false;
    const run = async () => {
      try {
        for await (const chunk of stream) {
          if (cancelled) break;
          renderer.push(chunk);
        }
        if (!cancelled) renderer.flush();
      } catch (err) {
        if (!cancelled) onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    };
    run();

    return () => {
      cancelled = true;
    };
  // stream identity change resets everything
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  if (streamWithComponents) {
    return (
      <div className={className} style={style}>
        {committedParts.map((html, i) => (
          <Fragment key={i}>{renderHtml(html, components)}</Fragment>
        ))}
        {speculativeHtml && (
          <Fragment>{renderHtml(speculativeHtml, components)}</Fragment>
        )}
      </div>
    );
  }

  // ── Streaming (no custom components) — fast innerHTML+= path ──────────
  if (stream) {
    const streamProps: Parameters<typeof MarkdownStream>[0] = { stream };
    if (className !== undefined) streamProps.className = className;
    if (style !== undefined) streamProps.style = style;
    if (plugins !== undefined) streamProps.plugins = plugins;
    if (markdownItOptions !== undefined) streamProps.markdownItOptions = markdownItOptions;
    if (onComplete !== undefined) streamProps.onComplete = onComplete;
    if (onError !== undefined) streamProps.onError = onError;
    return <MarkdownStream {...streamProps} />;
  }

  // ── Static ─────────────────────────────────────────────────────────────
  const md = content ?? children ?? '';

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const html = useMemo(() => {
    const opts: RendererOptions = {};
    if (plugins !== undefined) opts.plugins = plugins;
    if (markdownItOptions !== undefined) opts.markdownItOptions = markdownItOptions;
    return MarkdownRenderer.render(md, opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [md, plugins, markdownItOptions]);

  if (components) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const parsed = useMemo(() => renderHtml(html, components), [html, components]);
    return <div className={className} style={style}>{parsed}</div>;
  }

  return (
    <div className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />
  );
};

AIMarkdown.displayName = 'AIMarkdown';
