# ai-markdown-renderer

A streaming-first markdown renderer built for AI chat interfaces. Drop it in, feed it tokens, get live-rendered output — no flickering, no layout shift, no full re-renders.

```
npm install ai-markdown-renderer
```

---

## The problem with existing solutions

Most markdown libraries were designed for static content. When used with LLM streams, they re-parse and re-render the entire document on every token. At 50 tokens/second over a 2 000-token response, that is 100 000 parse operations.

`ai-markdown-renderer` processes each character **once**. Completed blocks are committed to the DOM with `innerHTML +=` and never touched again. Only the current partial block (~100 chars) is re-processed per token.

| | ai-markdown-renderer | react-markdown |
|---|---|---|
| Streaming architecture | O(n) — committed blocks never re-render | O(n²) — full re-parse each token |
| Speedup at 50 paragraphs | **~30×** faster | baseline |
| Speedup at 200 paragraphs | **~150×** faster | baseline |
| Live speculative preview | Yes — partial blocks shown as they type | No |
| `<think>` / reasoning blocks | Built-in plugin | Not supported |
| Custom HTML block tags | Yes (`<sources>`, `<artifacts>`, …) | No |
| Default styles | Included, opt-in | None |

---

## Quick start

### Static render

```ts
import { renderMarkdown } from 'ai-markdown-renderer';

document.getElementById('output').innerHTML = renderMarkdown('# Hello\n\nThis is **markdown**.');
```

### React — static

```tsx
import { AIMarkdown } from 'ai-markdown-renderer/react';

<AIMarkdown className="ai-markdown">{markdownString}</AIMarkdown>
```

### React — streaming from OpenAI

```tsx
import { AIMarkdown } from 'ai-markdown-renderer/react';

async function* streamResponse(prompt: string) {
  const stream = await openai.chat.completions.create({
    model: 'gpt-4o', messages: [{ role: 'user', content: prompt }], stream: true,
  });
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? '';
    if (text) yield text;
  }
}

function Response({ prompt }: { prompt: string }) {
  const stream = useMemo(() => streamResponse(prompt), [prompt]);
  return (
    <AIMarkdown
      className="ai-markdown"
      stream={stream}
      onComplete={(html) => console.log('done')}
    />
  );
}
```

### React — streaming from Anthropic

```tsx
async function* streamResponse(prompt: string) {
  const stream = await anthropic.messages.stream({
    model: 'claude-opus-4-6', max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      yield chunk.delta.text;
    }
  }
}
```

---

## Styling

### Auto-inject (React)

When you import from `ai-markdown-renderer/react`, the default stylesheet is injected automatically. Add `className="ai-markdown"` to your wrapper:

```tsx
<AIMarkdown className="ai-markdown" stream={stream} />
```

### Manual import (vanilla JS / other frameworks)

```ts
import 'ai-markdown-renderer/styles';
```

or in HTML:

```html
<link rel="stylesheet" href="node_modules/ai-markdown-renderer/dist/styles/default.css" />
```

### Theme with CSS variables

All styles are scoped to `.ai-markdown` and driven by custom properties. Override any variable to match your design:

```css
.ai-markdown {
  --ai-md-font:    'Inter', system-ui, sans-serif;
  --ai-md-mono:    'JetBrains Mono', monospace;
  --ai-md-text:    #1a1a1a;
  --ai-md-muted:   #737373;
  --ai-md-subtle:  #a3a3a3;
  --ai-md-border:  #e5e7eb;
  --ai-md-surface: #f9fafb;
  --ai-md-radius:  8px;
}
```

### Custom React components

Replace any HTML element with your own component — the same API as react-markdown:

```tsx
import { AIMarkdown, type MarkdownComponents } from 'ai-markdown-renderer/react';

const components: MarkdownComponents = {
  h1: ({ children }) => <h1 className="text-3xl font-bold">{children}</h1>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener" className="text-blue-600 underline">
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    const lang = /language-(\w+)/.exec(className ?? '')?.[1];
    return lang
      ? <SyntaxBlock lang={lang}>{children}</SyntaxBlock>
      : <code className="bg-gray-100 px-1 rounded text-sm">{children}</code>;
  },
};

<AIMarkdown content={markdown} components={components} />
```

---

## Plugins

### Math — KaTeX

Renders `$inline$` and `$$block$$` LaTeX. Shows a pulsing placeholder while a block formula is streaming to prevent KaTeX error flashes on incomplete input.

```bash
npm install katex
```

```tsx
import { createMathPlugin } from 'ai-markdown-renderer/plugins/math';

<AIMarkdown
  className="ai-markdown"
  stream={stream}
  plugins={[createMathPlugin()]}
/>
```

```html
<!-- Include the KaTeX stylesheet -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex/dist/katex.min.css" />
```

Options:

```ts
createMathPlugin({
  katexOptions: {
    macros: { '\\RR': '\\mathbb{R}' },
    throwOnError: false,
    output: 'html',
  },
})
```

---

### Thinking blocks — `<think>`

Renders reasoning traces produced by models like Claude, DeepSeek, and QwQ. Shows animated dots while thinking is in progress; collapses into a `<details>` summary when the block completes.

```tsx
import { createThinkingPlugin } from 'ai-markdown-renderer/plugins/thinking';

<AIMarkdown
  className="ai-markdown"
  stream={stream}
  plugins={[createThinkingPlugin({ headerLabel: 'Reasoning' })]}
/>
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `headerLabel` | `string` | `'Thinking'` | Text shown in the collapsed summary |
| `defaultOpen` | `boolean` | `false` | Start the block expanded |
| `classPrefix` | `string` | `'ai-thinking'` | CSS class prefix for all generated elements |

---

### Code blocks

Wraps fenced code in a header bar with language badge, line count, and a one-click copy button. Syntax highlighting via highlight.js (loaded from `window.hljs`) when available.

```tsx
import { createCodeBlockPlugin } from 'ai-markdown-renderer/plugins/code-block';

<AIMarkdown
  className="ai-markdown"
  stream={stream}
  plugins={[createCodeBlockPlugin()]}
/>
```

| Option | Type | Default |
|--------|------|---------|
| `showLanguage` | `boolean` | `true` |
| `showLineCount` | `boolean` | `true` |
| `showCopyButton` | `boolean` | `true` |
| `copyLabel` | `string` | `'Copy'` |
| `copiedLabel` | `string` | `'Copied!'` |

---

### Syntax highlighting (advanced)

For full control over the highlighter — Shiki with VS Code themes, Prism, or a custom adapter:

```ts
import {
  createSyntaxHighlightPlugin,
  createHighlightJsAdapter,
  createShikiAdapter,
} from 'ai-markdown-renderer/plugins/syntax-highlight';

// highlight.js — synchronous, ~30 KB gzipped
const plugin = createSyntaxHighlightPlugin({
  adapter: createHighlightJsAdapter(),
});

// Shiki — async, VS Code-quality themes
const plugin = createSyntaxHighlightPlugin({
  adapter: createShikiAdapter({ theme: 'github-dark' }),
});
```

Bring your own highlighter:

```ts
import type { HighlightAdapter } from 'ai-markdown-renderer';

const myAdapter: HighlightAdapter = {
  highlight(code, lang) {
    return myHighlighter.highlight(code, { language: lang }).value ?? null;
  },
  async load() {
    await myHighlighter.init();
  },
};
```

---

## Presets

Presets are convenience constructors that bundle common plugin combinations.

### Standard — syntax highlighting only

```ts
import { createStandardRenderer } from 'ai-markdown-renderer/presets/standard';

const renderer = createStandardRenderer();
```

### Full — syntax highlighting + math

```ts
import { createFullRenderer } from 'ai-markdown-renderer/presets/full';

const renderer = createFullRenderer({
  math: { katexOptions: { macros: { '\\N': '\\mathbb{N}' } } },
  extraPlugins: [myPlugin],
});
```

---

## Custom block tags

Register arbitrary HTML tag names as **atomic blocks**. The entire `<tag>…</tag>` is buffered as a single unit — blank lines inside will not trigger an early commit. This is how `<sources>` panels, `<artifacts>`, and other LLM-specific constructs are handled.

```tsx
// Via renderer options
const renderer = new MarkdownRenderer({
  customBlockTags: ['sources', 'artifacts'],
});

// Via AIMarkdown
<AIMarkdown
  stream={stream}
  customBlockTags={['sources', 'artifacts']}
/>

// Or declare inside a plugin so the tag ships with it
const sourcesPlugin: Plugin = {
  name: 'sources',
  customBlockTags: ['sources'],
  hooks: {
    'after-render'(html) {
      return html.replace(
        /<sources>([\s\S]*?)<\/sources>/,
        '<aside class="sources">$1</aside>',
      );
    },
  },
};
```

---

## Writing a plugin

The plugin API exposes three pipeline hooks and the ability to register markdown-it rules:

```ts
import type { Plugin } from 'ai-markdown-renderer';

const calloutPlugin: Plugin = {
  name: 'callout',

  // Runs just before a completed block is passed to markdown-it.
  // state.mode tells you the block type: 'paragraph', 'code-fence', etc.
  // Return the (possibly transformed) raw markdown string.
  hooks: {
    'before-commit'(rawBlock, state) {
      return rawBlock.replace(/^:::(\w+)\n([\s\S]*?):::/m, (_, type, body) =>
        `<div class="callout callout-${type}">\n\n${body}\n\n</div>`,
      );
    },

    // Runs after markdown-it renders a block to HTML.
    // Return the (possibly transformed) HTML string.
    'after-render'(html, rawBlock) {
      return html.replace(/<table>/g, '<table class="data-table">');
    },

    // Runs once when flush() is called.
    'on-flush'() {
      analytics.track('stream_complete');
    },
  },

  // Register markdown-it plugins — called once at construction.
  markdownItPlugins: [
    (md) => {
      // md is the MarkdownIt instance; add rules, override renderers, etc.
      md.renderer.rules.image = (tokens, idx) => `<img ...>`;
    },
  ],

  // HTML tags to buffer as atomic blocks.
  customBlockTags: ['callout'],
};
```

---

## Vanilla JS

```ts
import { MarkdownRenderer } from 'ai-markdown-renderer';
import { createCodeBlockPlugin } from 'ai-markdown-renderer/plugins/code-block';
import { createMathPlugin } from 'ai-markdown-renderer/plugins/math';
import { createThinkingPlugin } from 'ai-markdown-renderer/plugins/thinking';
import 'ai-markdown-renderer/styles';

const renderer = new MarkdownRenderer({
  plugins: [
    createThinkingPlugin(),
    createCodeBlockPlugin(),
    createMathPlugin(),
  ],
});

const committed   = document.getElementById('committed');
const speculative = document.getElementById('speculative');

renderer.on('delta', ({ appendHtml, speculativeHtml }) => {
  // appendHtml: newly committed block — append once, never re-render
  if (appendHtml) committed.innerHTML += appendHtml;
  // speculativeHtml: current partial block — replace on every token
  speculative.innerHTML = speculativeHtml;
});

renderer.on('flush', () => {
  speculative.innerHTML = '';
});

renderer.on('error', (err) => console.error(err));

// Feed tokens from any source
for await (const chunk of llmStream) {
  renderer.push(chunk);
}
renderer.flush();
```

```html
<div class="ai-markdown">
  <div id="committed"></div>
  <div id="speculative" style="opacity: 0.7"></div>
</div>
```

---

## React hook

`useMarkdownStream` exposes the renderer directly for advanced use cases — custom DOM strategies, virtual lists, or per-block animations:

```tsx
import { useMarkdownStream } from 'ai-markdown-renderer/react';

function StreamingResponse({ stream }: { stream: AsyncIterable<string> }) {
  const { committedRef, speculativeHtml, push, flush, isStreaming } = useMarkdownStream({
    plugins: [createCodeBlockPlugin(), createMathPlugin()],
  });

  useEffect(() => {
    (async () => {
      for await (const chunk of stream) push(chunk);
      flush();
    })();
  }, [stream]);

  return (
    <div className="ai-markdown">
      <div ref={committedRef} />
      <div
        dangerouslySetInnerHTML={{ __html: speculativeHtml }}
        style={{ opacity: isStreaming ? 0.7 : 1 }}
      />
    </div>
  );
}
```

---

## API reference

### `renderMarkdown(markdown, options?)`

One-shot synchronous render. Returns the full HTML string.

### `MarkdownRenderer`

| Member | Description |
|--------|-------------|
| `new MarkdownRenderer(options?)` | Create a renderer instance |
| `.push(chunk)` | Feed the next text chunk |
| `.flush()` | Signal end of stream; commits all remaining content |
| `.reset()` | Reset to initial state for reuse |
| `.currentHtml` | Full HTML at any point: committed + speculative |
| `.speculativeHtml` | Only the in-progress trailing block |
| `.on(event, handler)` | Subscribe to `delta`, `flush`, or `error` |
| `.off(event, handler)` | Unsubscribe |
| `MarkdownRenderer.render(markdown, options?)` | Static one-shot render (same as `renderMarkdown`) |

### `RendererOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `plugins` | `Plugin[]` | `[]` | Plugins to apply |
| `customBlockTags` | `string[]` | `[]` | HTML tag names to buffer atomically |
| `speculativeBufferLimit` | `number` | `8192` | Force-commit if the buffer exceeds this many bytes |
| `debounce` | `number` | `0` | Debounce `delta` events in milliseconds |
| `markdownItOptions` | `object` | — | Options forwarded to the markdown-it constructor |

### `AIMarkdown` props

| Prop | Type | Description |
|------|------|-------------|
| `children` | `string` | Static markdown as JSX children |
| `content` | `string` | Static markdown as a prop (takes precedence over `children`) |
| `stream` | `AsyncIterable<string>` | Live streaming source |
| `className` | `string` | CSS class on the outer `<div>` |
| `style` | `CSSProperties` | Inline styles on the outer `<div>` |
| `plugins` | `Plugin[]` | Plugins to enable |
| `components` | `MarkdownComponents` | Custom React components per HTML tag |
| `markdownItOptions` | `object` | Forwarded to markdown-it |
| `onComplete` | `(html: string) => void` | Called when streaming finishes |
| `onError` | `(err: Error) => void` | Called on stream error |

### `RenderDelta`

Emitted on every `delta` event:

| Field | Type | Description |
|-------|------|-------------|
| `appendHtml` | `string` | Newly committed HTML — append to the DOM once |
| `speculativeHtml` | `string` | Current partial-block HTML — replace on every event |
| `version` | `number` | Monotonically increasing, useful for ordering |

---

## Package exports

| Import path | Contents |
|---|---|
| `ai-markdown-renderer` | `MarkdownRenderer`, `renderMarkdown`, all types |
| `ai-markdown-renderer/react` | `AIMarkdown`, `MarkdownStream`, `useMarkdownStream`, types |
| `ai-markdown-renderer/plugins/math` | `createMathPlugin` |
| `ai-markdown-renderer/plugins/thinking` | `createThinkingPlugin` |
| `ai-markdown-renderer/plugins/code-block` | `createCodeBlockPlugin` |
| `ai-markdown-renderer/plugins/syntax-highlight` | `createSyntaxHighlightPlugin`, `createHighlightJsAdapter`, `createShikiAdapter` |
| `ai-markdown-renderer/presets/standard` | `createStandardRenderer` |
| `ai-markdown-renderer/presets/full` | `createFullRenderer` |
| `ai-markdown-renderer/styles` | Default stylesheet (import side-effect) |

---

## License

MIT
