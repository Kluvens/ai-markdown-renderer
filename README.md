# ai-markdown-renderer

A streaming-first markdown renderer built for AI applications. While libraries like `react-markdown` re-parse the entire document on every token (O(n²)), `ai-markdown-renderer` uses an O(n) incremental approach — committed blocks are rendered once and never touched again. Only the current partial block (~100 chars) is re-processed per token.

**34× faster** than naive re-parse at 50 paragraphs. **171× faster** at 200 paragraphs. The gap grows with document length.

---

## Features

- **O(n) streaming** — custom block splitter maintains parse state across chunk boundaries
- **Zero-boilerplate React API** — `<AIMarkdown stream={...} />` just works
- **Math support** — KaTeX inline `$...$` and block `$$...$$`, no blink during streaming
- **`<think>` block support** — renders Claude / DeepSeek / QwQ reasoning as a collapsible `<details>`
- **Syntax highlighting** — highlight.js or Shiki adapter
- **AI-aware code blocks** — language badge, line count, copy button, auto-detection
- **Streaming UX** — animated placeholder for in-progress math blocks, pulse on streaming tables, bouncing dots during thinking
- **Plugin system** — `before-commit`, `after-render`, `on-flush` hooks + markdown-it plugin registration
- **No leaked styles** — all CSS scoped to `.ai-markdown`, zero global side effects
- **SSR safe** — style injection skipped when `document` is unavailable
- **TypeScript** — full types, ships ESM + CJS + `.d.ts`

---

## Installation

```bash
npm install ai-markdown-renderer
```

Peer dependencies (install what you need):

```bash
npm install katex          # for math
npm install highlight.js   # for syntax highlighting
```

---

## Quick start

### React

```jsx
import { AIMarkdown } from 'ai-markdown-renderer/react';

// Static content — wrap pattern
<AIMarkdown className="ai-markdown">{markdownText}</AIMarkdown>

// Static content — prop pattern
<AIMarkdown className="ai-markdown" content={markdownText} />

// Streaming — hand it any AsyncIterable<string>
<AIMarkdown className="ai-markdown" stream={llmStream} />
```

Styles are automatically injected when you import the React adapter. Add `className="ai-markdown"` to opt in to the default styles.

### Vanilla JS

```js
import { renderMarkdown } from 'ai-markdown-renderer';

document.getElementById('output').innerHTML = renderMarkdown(markdownText);
```

### Streaming (vanilla)

```js
import { MarkdownRenderer } from 'ai-markdown-renderer';

const renderer = new MarkdownRenderer();
const committed = document.getElementById('committed');
const speculative = document.getElementById('speculative');

renderer.on('delta', ({ appendHtml, speculativeHtml }) => {
  committed.innerHTML += appendHtml;
  speculative.innerHTML = speculativeHtml;
});

renderer.on('flush', () => {
  speculative.innerHTML = '';
});

// Feed tokens as they arrive
renderer.push(chunk);
// ...
renderer.flush(); // call when stream ends
```

---

## Streaming with OpenAI

```jsx
import { AIMarkdown } from 'ai-markdown-renderer/react';
import OpenAI from 'openai';

const client = new OpenAI();

async function* streamTokens() {
  const stream = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Explain quantum entanglement' }],
    stream: true,
  });
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content;
    if (token) yield token;
  }
}

export default function App() {
  const [stream, setStream] = useState(null);

  return (
    <>
      <button onClick={() => setStream(streamTokens())}>Ask</button>
      {stream && (
        <AIMarkdown
          className="ai-markdown"
          stream={stream}
          onComplete={(html) => console.log('done')}
        />
      )}
    </>
  );
}
```

---

## Plugins

### Math (KaTeX)

```jsx
import { createMathPlugin } from 'ai-markdown-renderer/plugins/math';

const plugins = [createMathPlugin()];

<AIMarkdown className="ai-markdown" content={text} plugins={plugins} />
```

Renders `$E = mc^2$` inline and `$$...$$` as display math. While a block math formula is still streaming, a pulsing placeholder is shown instead of a KaTeX error flash.

### Syntax highlighting

```jsx
import { createSyntaxHighlightPlugin, createHighlightJsAdapter } from 'ai-markdown-renderer/plugins/syntax-highlight';

const plugins = [
  createSyntaxHighlightPlugin({ adapter: createHighlightJsAdapter() }),
];
```

### AI-aware code blocks

Adds a language badge, line count, and copy button to every code fence. Auto-detects language when not specified.

```jsx
import { createCodeBlockPlugin } from 'ai-markdown-renderer/plugins/code-block';

const plugins = [
  createCodeBlockPlugin({
    showCopyButton: true,   // default: true
    showLanguage: true,     // default: true
    showLineCount: true,    // default: true
    copyLabel: 'Copy',
    copiedLabel: 'Copied!',
  }),
];
```

### Thinking blocks (`<think>`)

Renders `<think>...</think>` blocks (Claude extended thinking, DeepSeek R1, QwQ) as a collapsible `<details>` element. While the block is still streaming, animated dots are shown.

```jsx
import { createThinkingPlugin } from 'ai-markdown-renderer/plugins/thinking';

const plugins = [
  createThinkingPlugin({
    headerLabel: 'Thinking',  // default: 'Thinking'
    defaultOpen: false,        // default: false
  }),
];
```

### All plugins together

```jsx
import { createThinkingPlugin } from 'ai-markdown-renderer/plugins/thinking';
import { createMathPlugin } from 'ai-markdown-renderer/plugins/math';
import { createCodeBlockPlugin } from 'ai-markdown-renderer/plugins/code-block';
import { createSyntaxHighlightPlugin, createHighlightJsAdapter } from 'ai-markdown-renderer/plugins/syntax-highlight';

// Define outside component (or useMemo) to keep array reference stable
const plugins = [
  createThinkingPlugin(),
  createMathPlugin(),
  createCodeBlockPlugin(),
  createSyntaxHighlightPlugin({ adapter: createHighlightJsAdapter() }),
];

<AIMarkdown className="ai-markdown" stream={stream} plugins={plugins} />
```

---

## Presets

If you don't want to wire up plugins manually:

```js
// highlight.js syntax highlighting included
import { createStandardRenderer } from 'ai-markdown-renderer/presets/standard';

// highlight.js + KaTeX math included
import { createFullRenderer } from 'ai-markdown-renderer/presets/full';

const renderer = createFullRenderer();
renderer.on('delta', ({ appendHtml, speculativeHtml }) => { /* ... */ });
renderer.push(chunk);
renderer.flush();
```

---

## Styling

### Default styles (auto-injected)

When you import `ai-markdown-renderer/react`, the default stylesheet is automatically injected into `<head>`. Add `className="ai-markdown"` to your wrapper to opt in:

```jsx
<AIMarkdown className="ai-markdown" content={text} />
```

All styles are scoped to `.ai-markdown` and use neutral black/grey/white — no colors imposed. Override via CSS custom properties:

```css
.ai-markdown {
  --ai-md-font:    'Inter', system-ui, sans-serif;
  --ai-md-mono:    'Fira Code', monospace;
  --ai-md-text:    #111;
  --ai-md-muted:   #666;
  --ai-md-border:  #e0e0e0;
  --ai-md-surface: #f5f5f5;
  --ai-md-radius:  5px;
}
```

### Manual stylesheet import

If you prefer to manage the CSS yourself:

```js
import 'ai-markdown-renderer/styles';
```

Or copy `node_modules/ai-markdown-renderer/dist/styles/default.css` as a starting point.

---

## Custom plugins

```ts
import type { Plugin } from 'ai-markdown-renderer';

const myPlugin: Plugin = {
  name: 'my-plugin',
  hooks: {
    // Transform raw block text before markdown-it sees it
    'before-commit': (rawBlock, state) => {
      return rawBlock.replace(/!!(.+?)!!/g, '<mark>$1</mark>');
    },
    // Transform rendered HTML after markdown-it
    'after-render': (html, rawBlock) => {
      return html.replace(/<table>/g, '<div class="table-wrap"><table>');
    },
    // Called once when flush() completes
    'on-flush': () => {
      console.log('stream done');
    },
  },
  // Register markdown-it plugins
  markdownItPlugins: [
    (md) => { /* mutate the md instance */ },
  ],
};
```

---

## React hook (advanced)

For full manual control (e.g. feeding tokens from a WebSocket):

```jsx
import { useMarkdownStream } from 'ai-markdown-renderer/react';

function ChatMessage() {
  const { committedRef, speculativeHtml, push, flush, isStreaming } = useMarkdownStream({
    plugins: [...],
  });

  return (
    <div className="ai-markdown">
      {/* Committed zone: injected via innerHTML, bypasses React reconciler */}
      <div ref={committedRef} />
      {/* Speculative zone: only the current partial block, goes through React */}
      {speculativeHtml && (
        <div dangerouslySetInnerHTML={{ __html: speculativeHtml }} />
      )}
    </div>
  );
}
```

---

## Performance

Measured against a naive approach that re-parses the full accumulated markdown on every token (equivalent to what react-markdown does on each state update):

| Document size | Naive (react-markdown style) | ai-markdown-renderer | Speedup |
|---|---|---|---|
| 50 paragraphs | ~157ms | ~5ms | **34×** |
| 200 paragraphs | ~1200ms | ~7ms | **171×** |
| 1000 single-char pushes | — | 1.6ms total | — |

The speedup grows with document length because the naive approach is O(n × tokens) while this library is O(tokens) — committed blocks are never re-parsed.

**Why `react-markdown` is slow for streaming:**
It passes the full markdown string through the remark → rehype → React pipeline on every render. At 50 tokens per second on a 500-word response, that means parsing the full 2500-character document 2500 times.

**How this library avoids it:**
The `StreamingBlockSplitter` detects block boundaries (blank lines, closing fences, `</think>`, etc.) in O(n) total. Once a block is committed, it's rendered by markdown-it once and its HTML is frozen. Only the current in-progress block (~100 chars) is re-rendered per token.

---

## Comparison with react-markdown

| | react-markdown | ai-markdown-renderer |
|---|---|---|
| Streaming support | ✗ | ✓ built-in |
| Parsing complexity | O(n²) per stream | O(n) total |
| `<think>` blocks | ✗ | ✓ |
| Math blink prevention | ✗ | ✓ |
| Streaming UX (placeholders) | ✗ | ✓ |
| Custom components per tag | ✓ strong | hooks |
| Plugin ecosystem | remark/rehype (large) | built-in plugins |
| Bundle size (gzipped) | ~43KB | ~40KB |
| SSR | ✓ | ✓ |

Use `react-markdown` if you need deep custom component rendering (replacing every `<a>`, `<img>`, etc. with your own React components) or rely on the remark/rehype plugin ecosystem.

Use `ai-markdown-renderer` for any AI chat UI, streaming responses, or performance-sensitive contexts.

---

## API reference

### `renderMarkdown(markdown, options?)`

One-shot static render. Returns an HTML string.

```ts
import { renderMarkdown } from 'ai-markdown-renderer';
const html = renderMarkdown('# Hello\n\n**world**');
```

### `MarkdownRenderer`

```ts
const renderer = new MarkdownRenderer(options?: RendererOptions);

renderer.push(chunk: string): void       // feed a token
renderer.flush(): void                   // signal end of stream
renderer.reset(): void                   // reuse for a new stream
renderer.currentHtml: string             // committed + speculative HTML snapshot
renderer.on('delta', (delta: RenderDelta) => void)
renderer.on('flush', (finalHtml: string) => void)
renderer.on('error', (err: Error) => void)

MarkdownRenderer.render(markdown, options?): string  // static one-shot
```

### `RendererOptions`

```ts
{
  plugins?: Plugin[];
  speculativeBufferLimit?: number;  // default: 8192 bytes
  debounce?: number;                // ms, default: 0
  markdownItOptions?: object;       // passed to markdown-it
}
```

### `<AIMarkdown>` props

```ts
{
  children?: string;                    // static markdown as children
  content?: string;                     // static markdown as prop
  stream?: AsyncIterable<string>;       // streaming source
  className?: string;
  style?: React.CSSProperties;
  plugins?: Plugin[];
  markdownItOptions?: object;
  onComplete?: (html: string) => void;
  onError?: (err: Error) => void;
}
```

### `Plugin`

```ts
{
  name: string;
  hooks?: {
    'before-commit'?: (rawBlock: string, state: ParseState) => string;
    'after-render'?: (html: string, rawBlock: string) => string;
    'on-flush'?: () => void;
  };
  markdownItPlugins?: Array<(md: object) => void>;
}
```

---

## Package exports

| Import path | Contents |
|---|---|
| `ai-markdown-renderer` | `MarkdownRenderer`, `renderMarkdown`, all types |
| `ai-markdown-renderer/react` | `AIMarkdown`, `MarkdownStream`, `useMarkdownStream` |
| `ai-markdown-renderer/plugins/thinking` | `createThinkingPlugin` |
| `ai-markdown-renderer/plugins/math` | `createMathPlugin` |
| `ai-markdown-renderer/plugins/code-block` | `createCodeBlockPlugin` |
| `ai-markdown-renderer/plugins/syntax-highlight` | `createSyntaxHighlightPlugin`, adapters |
| `ai-markdown-renderer/presets/standard` | `createStandardRenderer` (with highlight.js) |
| `ai-markdown-renderer/presets/full` | `createFullRenderer` (highlight.js + KaTeX) |
| `ai-markdown-renderer/styles` | Default CSS file (manual import) |

---

## License

MIT
