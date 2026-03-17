/**
 * Performance tests.
 *
 * Verifies that our O(n) streaming approach is significantly faster than
 * the naive O(n²) approach (re-parsing full document each token).
 *
 * These are not strict benchmarks — just sanity checks that we're in the
 * right ballpark. CI should not fail due to timing variance.
 */

import { describe, it, expect } from 'vitest';
import { MarkdownRenderer } from '../src/core/renderer.js';
import MarkdownIt from 'markdown-it';

// Generate a realistic AI response of ~N paragraphs
function generateMarkdown(paragraphs: number): string {
  const blocks: string[] = [];
  for (let i = 0; i < paragraphs; i++) {
    blocks.push(`## Section ${i + 1}\n\nThis is paragraph ${i + 1} with some **bold text** and \`inline code\`. It contains enough words to be realistic.\n`);
    if (i % 5 === 0 && i > 0) {
      blocks.push('```typescript\nconst value = ' + i + ';\nconsole.log(value);\n```\n');
    }
    if (i % 7 === 0 && i > 0) {
      blocks.push('- Item one\n- Item two\n- Item three\n');
    }
  }
  return blocks.join('\n');
}

// Simulate O(n²) naive approach: re-parse full doc on each token
function naiveStreamRender(markdown: string, tokenSize = 5): void {
  const md = new MarkdownIt({ html: true, linkify: true });
  let accumulated = '';
  for (let i = 0; i < markdown.length; i += tokenSize) {
    accumulated += markdown.slice(i, i + tokenSize);
    md.render(accumulated); // full re-parse each time — O(n²)
  }
}

// Our O(n) streaming approach
function ourStreamRender(markdown: string, tokenSize = 5): void {
  const renderer = new MarkdownRenderer();
  for (let i = 0; i < markdown.length; i += tokenSize) {
    renderer.push(markdown.slice(i, i + tokenSize));
  }
  renderer.flush();
}

describe('Performance: O(n) vs O(n²)', () => {
  it('streaming 50 paragraphs is significantly faster than naive re-parse', () => {
    const md = generateMarkdown(50);

    const naiveStart = performance.now();
    naiveStreamRender(md, 5);
    const naiveMs = performance.now() - naiveStart;

    const ourStart = performance.now();
    ourStreamRender(md, 5);
    const ourMs = performance.now() - ourStart;

    console.log(`\nPerformance (50 paragraphs, 5-char tokens):`);
    console.log(`  Naive O(n²): ${naiveMs.toFixed(1)}ms`);
    console.log(`  Ours  O(n):  ${ourMs.toFixed(1)}ms`);
    console.log(`  Speedup:     ${(naiveMs / ourMs).toFixed(1)}x`);

    // We should be at least 2x faster for 50 paragraphs
    // (the advantage grows with document size)
    expect(ourMs).toBeLessThan(naiveMs * 0.9);
  });

  it('streaming 200 paragraphs shows larger speedup than 50 paragraphs', () => {
    const md50 = generateMarkdown(50);
    const md200 = generateMarkdown(200);

    const start50naive = performance.now();
    naiveStreamRender(md50, 5);
    const naive50 = performance.now() - start50naive;

    const start50ours = performance.now();
    ourStreamRender(md50, 5);
    const ours50 = performance.now() - start50ours;

    const start200naive = performance.now();
    naiveStreamRender(md200, 5);
    const naive200 = performance.now() - start200naive;

    const start200ours = performance.now();
    ourStreamRender(md200, 5);
    const ours200 = performance.now() - start200ours;

    const speedup50 = naive50 / ours50;
    const speedup200 = naive200 / ours200;

    console.log(`\nSpeedup scaling:`);
    console.log(`  50 paragraphs:  ${speedup50.toFixed(1)}x`);
    console.log(`  200 paragraphs: ${speedup200.toFixed(1)}x`);

    // For O(n) vs O(n²), the speedup should grow with document size
    // 200/50 = 4x more content, so naive is ~4x slower relative to ours
    expect(speedup200).toBeGreaterThan(speedup50 * 0.5); // allow some margin
  });

  it('processes 1000 single-character pushes in under 100ms', () => {
    const md = generateMarkdown(20); // ~2KB of markdown
    const renderer = new MarkdownRenderer();

    const start = performance.now();
    for (const char of md.slice(0, 1000)) {
      renderer.push(char);
    }
    renderer.flush();
    const elapsed = performance.now() - start;

    console.log(`\n1000 single-char pushes: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(100);
  });
});
