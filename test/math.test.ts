/**
 * Math blink prevention tests.
 *
 * Verifies that:
 *   1. pendingLine getter exposes the current partial line
 *   2. suppressPartialInlineMath strips unclosed inline $…$ from speculative render
 *   3. math-block mode shows a placeholder instead of running KaTeX on partial LaTeX
 *   4. Completed math blocks render normally (no placeholder)
 */

import { describe, it, expect } from 'vitest';
import { MarkdownRenderer } from '../src/core/renderer.js';
import { StreamingBlockSplitter } from '../src/core/streaming-block-splitter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderChunked(markdown: string, chunkSize: number): string {
  const renderer = new MarkdownRenderer();
  for (let i = 0; i < markdown.length; i += chunkSize) {
    renderer.push(markdown.slice(i, i + chunkSize));
  }
  renderer.flush();
  return renderer.currentHtml;
}

// ---------------------------------------------------------------------------
// StreamingBlockSplitter.pendingLine getter
// ---------------------------------------------------------------------------

describe('StreamingBlockSplitter.pendingLine', () => {
  it('returns empty string when no partial line exists', () => {
    const splitter = new StreamingBlockSplitter(() => {});
    expect(splitter.pendingLine).toBe('');
  });

  it('returns the current partial line (no newline yet)', () => {
    const splitter = new StreamingBlockSplitter(() => {});
    splitter.push('Hello world'); // no \n
    expect(splitter.pendingLine).toBe('Hello world');
  });

  it('clears when a newline is received', () => {
    const splitter = new StreamingBlockSplitter(() => {});
    splitter.push('Hello world\n');
    expect(splitter.pendingLine).toBe('');
  });

  it('tracks the portion after the last newline', () => {
    const splitter = new StreamingBlockSplitter(() => {});
    splitter.push('Line one\nLine two partial');
    expect(splitter.pendingLine).toBe('Line two partial');
  });
});

// ---------------------------------------------------------------------------
// Math-block mode: placeholder during streaming
// ---------------------------------------------------------------------------

describe('math-block speculative rendering', () => {
  it('shows ai-math-loading placeholder while $$ block is open', () => {
    const renderer = new MarkdownRenderer();
    const speculatives: string[] = [];

    renderer.on('delta', (d) => {
      if (d.speculativeHtml) speculatives.push(d.speculativeHtml);
    });

    renderer.push('$$\n');
    renderer.push('\\int_0^{\\infty}');

    const lastSpec = speculatives[speculatives.length - 1] ?? '';
    expect(lastSpec).toContain('ai-math-loading');
    // Should NOT contain KaTeX error output (no <span class="katex-error">)
    expect(lastSpec).not.toContain('katex-error');
    // Raw LaTeX should be visible in the placeholder
    expect(lastSpec).toContain('int_0^');
  });

  it('does not show placeholder for completed $$ block', () => {
    const md = '$$\n\\int_0^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$\n';
    const html = renderChunked(md, 10);
    // After flush, the block should NOT have the loading placeholder
    expect(html).not.toContain('ai-math-loading');
  });

  it('placeholder is chunk-position-independent', () => {
    const renderer1 = new MarkdownRenderer();
    const renderer2 = new MarkdownRenderer();
    const spec1: string[] = [];
    const spec2: string[] = [];

    renderer1.on('delta', (d) => { if (d.speculativeHtml) spec1.push(d.speculativeHtml); });
    renderer2.on('delta', (d) => { if (d.speculativeHtml) spec2.push(d.speculativeHtml); });

    const input = '$$\n\\int_0^{1} f(x) dx';
    // Feed as single chunk vs char-by-char
    renderer1.push(input);
    for (const ch of input) renderer2.push(ch);

    const last1 = spec1[spec1.length - 1] ?? '';
    const last2 = spec2[spec2.length - 1] ?? '';
    expect(last1).toContain('ai-math-loading');
    expect(last2).toContain('ai-math-loading');
  });
});

// ---------------------------------------------------------------------------
// Inline math: suppress partial $…$ in pending line
// ---------------------------------------------------------------------------

describe('inline math: no blink on partial $', () => {
  it('does not show literal $ text while typing inside inline math', () => {
    const renderer = new MarkdownRenderer();
    const speculatives: string[] = [];

    renderer.on('delta', (d) => {
      if (d.speculativeHtml) speculatives.push(d.speculativeHtml);
    });

    // Simulate streaming "The energy is $E = mc" (closing $ not yet arrived)
    renderer.push('The energy is $E = mc');

    const lastSpec = speculatives[speculatives.length - 1] ?? '';
    // The speculative HTML must not contain the raw $ token followed by formula text
    // (which would abruptly transform when $ closes)
    expect(lastSpec).not.toContain('$E = mc');
    // The text before $ should still be present
    expect(lastSpec).toContain('The energy is');
  });

  it('renders completed inline math normally (no placeholder)', () => {
    const renderer = new MarkdownRenderer();
    renderer.push('The energy is $E = mc^2$.\n\n');
    renderer.flush();
    const html = renderer.currentHtml;
    // Final committed output must not have the loading placeholder
    expect(html).not.toContain('ai-math-loading');
    expect(html).toContain('The energy is');
  });

  it('handles multiple inline math spans in one line', () => {
    const renderer = new MarkdownRenderer();
    const speculatives: string[] = [];

    renderer.on('delta', (d) => {
      if (d.speculativeHtml) speculatives.push(d.speculativeHtml);
    });

    // Two complete spans + one open span: $a$ and $b$ done, $c partial
    renderer.push('See $a$ and $b$ and $c = d');

    const lastSpec = speculatives[speculatives.length - 1] ?? '';
    // Raw unclosed $c = d should not appear
    expect(lastSpec).not.toContain('$c = d');
  });

  it('does not suppress escaped \\$', () => {
    const renderer = new MarkdownRenderer();
    const speculatives: string[] = [];

    renderer.on('delta', (d) => {
      if (d.speculativeHtml) speculatives.push(d.speculativeHtml);
    });

    // \$ is an escaped literal dollar — should not count toward inline math pairing
    renderer.push('Price is \\$50 and formula is $x');

    const lastSpec = speculatives[speculatives.length - 1] ?? '';
    // The partial $x should be stripped (odd unescaped $)
    expect(lastSpec).not.toContain('$x');
  });
});

// ---------------------------------------------------------------------------
// Regression: completed math blocks are unaffected
// ---------------------------------------------------------------------------

describe('math rendering regression', () => {
  it('block math renders after flush', () => {
    const md = '$$\nE = mc^2\n$$\n\nSome text.\n';
    const html = renderChunked(md, 3);
    expect(html).toContain('Some text');
    // No placeholder in final output
    expect(html).not.toContain('ai-math-loading');
  });

  it('inline math in paragraph renders after flush (no placeholder)', () => {
    const md = 'The formula $x^2 + y^2 = r^2$ describes a circle.\n\n';
    const html = renderChunked(md, 5);
    expect(html).toContain('describes a circle');
    // No placeholder in committed output
    expect(html).not.toContain('ai-math-loading');
  });
});
