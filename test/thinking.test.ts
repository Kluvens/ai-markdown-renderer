/**
 * Think-block tests.
 *
 * Verifies that <think>...</think> blocks are:
 *   1. Buffered atomically (not committed at blank lines mid-reasoning)
 *   2. Committed only when </think> is encountered
 *   3. Handled gracefully when stream ends before </think>
 *   4. Rendered correctly by createThinkingPlugin()
 *   5. Correct regardless of chunk boundary (same invariant as other block types)
 */

import { describe, it, expect } from 'vitest';
import { MarkdownRenderer } from '../src/core/renderer.js';
import { StreamingBlockSplitter } from '../src/core/streaming-block-splitter.js';
import { createThinkingPlugin } from '../src/plugins/thinking/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderChunked(markdown: string, chunkSize: number, plugins = [] as ReturnType<typeof createThinkingPlugin>[]): string {
  const renderer = new MarkdownRenderer({ plugins });
  for (let i = 0; i < markdown.length; i += chunkSize) {
    renderer.push(markdown.slice(i, i + chunkSize));
  }
  renderer.flush();
  return renderer.currentHtml;
}

const THINK_MD = `<think>
Let me reason about this.

Even blank lines inside should not commit the block early.
Multiple paragraphs of reasoning here.
</think>

Here is my answer.
`;

// ---------------------------------------------------------------------------
// Splitter: atomic buffering
// ---------------------------------------------------------------------------

describe('StreamingBlockSplitter — think-block mode', () => {
  it('enters think-block mode on <think> and stays until </think>', () => {
    const committed: string[] = [];
    const splitter = new StreamingBlockSplitter((b) => committed.push(b));

    splitter.push('<think>\n');
    expect(splitter.currentState.mode).toBe('think-block');
    expect(committed).toHaveLength(0);

    splitter.push('Some reasoning.\n');
    expect(splitter.currentState.mode).toBe('think-block');
    expect(committed).toHaveLength(0);

    // Blank line inside think block should NOT commit
    splitter.push('\n');
    expect(splitter.currentState.mode).toBe('think-block');
    expect(committed).toHaveLength(0);

    splitter.push('</think>\n');
    expect(splitter.currentState.mode).toBe('normal');
    expect(committed).toHaveLength(1);
    expect(committed[0]).toContain('<think>');
    expect(committed[0]).toContain('</think>');
    expect(committed[0]).toContain('Some reasoning.');
  });

  it('commits think block as a single atomic unit', () => {
    const committed: string[] = [];
    const splitter = new StreamingBlockSplitter((b) => committed.push(b));

    splitter.push('<think>\nLine A\n\nLine B after blank\n</think>\n');
    expect(committed).toHaveLength(1);
    const block = committed[0]!;
    expect(block).toContain('Line A');
    expect(block).toContain('Line B after blank');
  });

  it('gracefully closes unclosed think block on flush', () => {
    const committed: string[] = [];
    const splitter = new StreamingBlockSplitter((b) => committed.push(b));

    splitter.push('<think>\nUnfinished reasoning...');
    splitter.flush();

    expect(committed).toHaveLength(1);
    expect(committed[0]).toContain('<think>');
    expect(committed[0]).toContain('</think>');
  });

  it('applyGracefulDegradation closes think block', () => {
    const splitter = new StreamingBlockSplitter(() => {});
    splitter.push('<think>\nPartial reasoning');
    const raw = splitter.getSpeculativeBuffer();
    const degraded = splitter.applyGracefulDegradation(raw);
    expect(degraded).toContain('</think>');
  });

  it('handles <think> with attributes', () => {
    const committed: string[] = [];
    const splitter = new StreamingBlockSplitter((b) => committed.push(b));

    splitter.push('<think type="global-reasoning">\nReasoning with attributes.\n</think>\n');
    expect(committed).toHaveLength(1);
    expect(committed[0]).toContain('<think');
    expect(committed[0]).toContain('Reasoning with attributes');
  });

  it('text after </think> starts a new block', () => {
    const committed: string[] = [];
    const splitter = new StreamingBlockSplitter((b) => committed.push(b));

    splitter.push('<think>\nReasoning.\n</think>\n\nActual answer.\n\n');
    // think block committed + paragraph committed
    expect(committed.length).toBeGreaterThanOrEqual(1);
    const allText = committed.join('');
    expect(allText).toContain('<think>');
    expect(allText).toContain('Actual answer');
  });
});

// ---------------------------------------------------------------------------
// Chunk boundary invariant
// ---------------------------------------------------------------------------

describe('think-block chunk boundary invariant', () => {
  it('produces identical output for chunk sizes 1, 3, 10, line', () => {
    const html1 = renderChunked(THINK_MD, 1);
    const html3 = renderChunked(THINK_MD, 3);
    const html10 = renderChunked(THINK_MD, 10);
    const htmlLine = renderChunked(THINK_MD, 80);

    expect(html1).toBe(html3);
    expect(html3).toBe(html10);
    expect(html10).toBe(htmlLine);
  });
});

// ---------------------------------------------------------------------------
// createThinkingPlugin rendering
// ---------------------------------------------------------------------------

describe('createThinkingPlugin', () => {
  it('renders committed think block as <details>', () => {
    const html = renderChunked(THINK_MD, 10, [createThinkingPlugin()]);
    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    expect(html).toContain('Thinking');
    // Raw <think> tags should not appear in the output
    expect(html).not.toContain('<think>');
    expect(html).not.toContain('</think>');
  });

  it('includes reasoning content in the output', () => {
    const html = renderChunked(THINK_MD, 5, [createThinkingPlugin()]);
    expect(html).toContain('Let me reason');
  });

  it('respects defaultOpen option', () => {
    const htmlClosed = renderChunked(THINK_MD, 10, [createThinkingPlugin({ defaultOpen: false })]);
    const htmlOpen = renderChunked(THINK_MD, 10, [createThinkingPlugin({ defaultOpen: true })]);
    expect(htmlClosed).not.toContain('<details class="ai-thinking-block" open>');
    expect(htmlOpen).toContain(' open>');
  });

  it('respects custom headerLabel', () => {
    const html = renderChunked(THINK_MD, 10, [createThinkingPlugin({ headerLabel: 'Reasoning' })]);
    expect(html).toContain('Reasoning');
  });

  it('passes non-think blocks through unchanged', () => {
    const md = '# Hello\n\nWorld\n';
    const withPlugin = renderChunked(md, 5, [createThinkingPlugin()]);
    const withoutPlugin = renderChunked(md, 5);
    expect(withPlugin).toBe(withoutPlugin);
  });
});

// ---------------------------------------------------------------------------
// Speculative rendering
// ---------------------------------------------------------------------------

describe('think-block speculative rendering', () => {
  it('emits streaming indicator while in think-block mode', () => {
    const renderer = new MarkdownRenderer({ plugins: [createThinkingPlugin()] });
    const speculatives: string[] = [];

    renderer.on('delta', (d) => {
      if (d.speculativeHtml) speculatives.push(d.speculativeHtml);
    });

    renderer.push('<think>\nSome reasoning that is not yet done...');

    // While inside think block, speculative HTML should be the animated indicator
    const lastSpec = speculatives[speculatives.length - 1] ?? '';
    expect(lastSpec).toContain('ai-thinking-streaming');
    expect(lastSpec).not.toContain('Some reasoning');
  });
});
