/**
 * Chunk boundary torture tests.
 *
 * The fundamental invariant: output must be identical regardless of how
 * the input is chunked. We test the same markdown split at every possible
 * position (1-char chunks, word-boundary chunks, line chunks, etc.)
 */

import { describe, it, expect } from 'vitest';
import { MarkdownRenderer } from '../src/core/renderer.js';

// ---------------------------------------------------------------------------
// Helper: render the same markdown with different chunk sizes
// ---------------------------------------------------------------------------

function renderChunked(markdown: string, chunkSize: number): string {
  const renderer = new MarkdownRenderer();
  for (let i = 0; i < markdown.length; i += chunkSize) {
    renderer.push(markdown.slice(i, i + chunkSize));
  }
  renderer.flush();
  return renderer.currentHtml;
}

function renderAllAtOnce(markdown: string): string {
  return MarkdownRenderer.render(markdown);
}

// ---------------------------------------------------------------------------
// Test documents
// ---------------------------------------------------------------------------

const SIMPLE_PARAGRAPH = 'Hello, world!\n\nSecond paragraph.\n';

const HEADINGS = `# H1\n\n## H2\n\n### H3\n\nParagraph under H3.\n`;

const CODE_BLOCK = `Before code.\n\n\`\`\`typescript\nconst x = 42;\nconsole.log(x);\n\`\`\`\n\nAfter code.\n`;

const INLINE_ELEMENTS = `**bold** _italic_ \`code\` [link](https://example.com) ~~strike~~\n`;

const LIST_UNORDERED = `- item one\n- item two\n- item three\n\nafter list\n`;

const LIST_ORDERED = `1. first\n2. second\n3. third\n\nafter\n`;

const BLOCKQUOTE = `> This is a blockquote.\n> It continues here.\n\nafter\n`;

const TABLE = `| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |\n\nafter\n`;

const MIXED = `
# Introduction

This is a **bold** sentence with \`inline code\`.

## Code Example

\`\`\`python
def hello(name: str) -> str:
    return f"Hello, {name}!"
\`\`\`

## Lists

- First item
- Second item
  - Nested item
- Third item

## Table

| Feature | Status |
|---------|--------|
| Streaming | ✅ |
| Math | ✅ |

## Blockquote

> This is a blockquote with **bold** text.

Final paragraph.
`.trim() + '\n';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StreamingBlockSplitter — chunk boundary invariants', () => {
  const testCases = [
    { name: 'simple paragraph', md: SIMPLE_PARAGRAPH },
    { name: 'headings', md: HEADINGS },
    { name: 'code block', md: CODE_BLOCK },
    { name: 'inline elements', md: INLINE_ELEMENTS },
    { name: 'unordered list', md: LIST_UNORDERED },
    { name: 'ordered list', md: LIST_ORDERED },
    { name: 'blockquote', md: BLOCKQUOTE },
    { name: 'table', md: TABLE },
    { name: 'mixed document', md: MIXED },
  ];

  for (const { name, md } of testCases) {
    it(`${name}: 1-char chunks produce same output as full render`, () => {
      const full = renderAllAtOnce(md);
      const chunked = renderChunked(md, 1);
      expect(chunked).toBe(full);
    });

    it(`${name}: 5-char chunks produce same output as full render`, () => {
      const full = renderAllAtOnce(md);
      const chunked = renderChunked(md, 5);
      expect(chunked).toBe(full);
    });

    it(`${name}: 10-char chunks produce same output as full render`, () => {
      const full = renderAllAtOnce(md);
      const chunked = renderChunked(md, 10);
      expect(chunked).toBe(full);
    });

    it(`${name}: line-by-line chunks produce same output as full render`, () => {
      const full = renderAllAtOnce(md);
      const renderer = new MarkdownRenderer();
      for (const line of md.split('\n')) {
        renderer.push(line + '\n');
      }
      renderer.flush();
      expect(renderer.currentHtml).toBe(full);
    });
  }
});

describe('MarkdownRenderer delta events', () => {
  it('emits delta events with non-empty appendHtml for each committed block', () => {
    const md = 'Para one.\n\nPara two.\n\nPara three.\n';
    const renderer = new MarkdownRenderer();
    const deltas: string[] = [];

    renderer.on('delta', (d) => {
      if (d.appendHtml) deltas.push(d.appendHtml);
    });

    renderer.push(md);
    renderer.flush();

    expect(deltas.length).toBeGreaterThanOrEqual(1);
    const combined = deltas.join('');
    expect(combined).toContain('Para one.');
    expect(combined).toContain('Para two.');
    expect(combined).toContain('Para three.');
  });

  it('emits flush event with final HTML', () => {
    const md = '# Hello\n\nWorld\n';
    const renderer = new MarkdownRenderer();
    let flushedHtml = '';

    renderer.on('flush', (html) => { flushedHtml = html; });
    renderer.push(md);
    renderer.flush();

    expect(flushedHtml).toContain('<h1>');
    expect(flushedHtml).toContain('Hello');
    expect(flushedHtml).toContain('World');
  });

  it('emits speculative HTML during streaming', () => {
    const renderer = new MarkdownRenderer();
    const speculatives: string[] = [];

    renderer.on('delta', (d) => {
      if (d.speculativeHtml) speculatives.push(d.speculativeHtml);
    });

    // Push character by character — the partial text should appear in speculative
    for (const char of 'Hello, world!') {
      renderer.push(char);
    }

    expect(speculatives.length).toBeGreaterThan(0);
    expect(speculatives[speculatives.length - 1]).toContain('Hello, world!');

    renderer.flush();
  });

  it('reset clears state and allows reuse', () => {
    const renderer = new MarkdownRenderer();
    renderer.push('First stream.\n');
    renderer.flush();
    const firstHtml = renderer.currentHtml;
    expect(firstHtml).toContain('First stream');

    renderer.reset();
    expect(renderer.currentHtml).toBe('');

    renderer.push('Second stream.\n');
    renderer.flush();
    const secondHtml = renderer.currentHtml;
    expect(secondHtml).toContain('Second stream');
    expect(secondHtml).not.toContain('First stream');
  });
});

describe('MarkdownRenderer.render static method', () => {
  it('renders a complete markdown string synchronously', () => {
    const html = MarkdownRenderer.render('# Hello\n\n**bold** text\n');
    expect(html).toContain('<h1>');
    expect(html).toContain('<strong>');
    expect(html).toContain('bold');
  });

  it('renders an empty string without errors', () => {
    expect(() => MarkdownRenderer.render('')).not.toThrow();
  });
});
