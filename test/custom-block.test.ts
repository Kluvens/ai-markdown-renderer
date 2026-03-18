/**
 * Custom block tag tests.
 *
 * Verifies that user-registered tags (e.g., <sources>, <artifacts>) are:
 *   1. Buffered atomically — blank lines inside do NOT trigger early commit
 *   2. Committed only when the matching closing tag is encountered
 *   3. Handled gracefully when stream ends before the closing tag
 *   4. Registered via RendererOptions.customBlockTags or Plugin.customBlockTags
 *   5. Correct regardless of chunk boundary
 */

import { describe, it, expect } from 'vitest';
import { MarkdownRenderer } from '../src/core/renderer.js';
import { StreamingBlockSplitter } from '../src/core/streaming-block-splitter.js';
import type { Plugin } from '../src/core/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderChunked(markdown: string, chunkSize: number, options: Parameters<typeof MarkdownRenderer>[0] = {}): string {
  const renderer = new MarkdownRenderer(options);
  for (let i = 0; i < markdown.length; i += chunkSize) {
    renderer.push(markdown.slice(i, i + chunkSize));
  }
  renderer.flush();
  return renderer.currentHtml;
}

function splitterCommits(markdown: string, customBlockTags: string[]): string[] {
  const commits: string[] = [];
  const splitter = new StreamingBlockSplitter((raw) => commits.push(raw), 8192, customBlockTags);
  for (const ch of markdown) splitter.push(ch);
  splitter.flush();
  return commits;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Custom block tags', () => {
  const SOURCES_MD = `<sources>
Source 1: https://example.com

Source 2: https://another.com
</sources>`;

  it('buffers atomically — blank line inside does NOT commit early', () => {
    const commits = splitterCommits(SOURCES_MD, ['sources']);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toContain('<sources>');
    expect(commits[0]).toContain('</sources>');
  });

  it('commits when closing tag is encountered', () => {
    const commits: string[] = [];
    const splitter = new StreamingBlockSplitter((raw) => commits.push(raw), 8192, ['sources']);
    splitter.push(SOURCES_MD + '\n');
    splitter.flush();
    expect(commits).toHaveLength(1);
    expect(commits[0]!.trim()).toBe(SOURCES_MD.trim());
  });

  it('renders correctly via MarkdownRenderer with customBlockTags option', () => {
    const html = renderChunked(SOURCES_MD, 5, { customBlockTags: ['sources'] });
    expect(html).toContain('<sources>');
    expect(html).toContain('</sources>');
  });

  it('works with plugin.customBlockTags', () => {
    const plugin: Plugin = {
      name: 'sources-plugin',
      customBlockTags: ['sources'],
    };
    const html = renderChunked(SOURCES_MD, 5, { plugins: [plugin] });
    expect(html).toContain('<sources>');
    expect(html).toContain('</sources>');
  });

  it('is chunk-boundary invariant', () => {
    const full = renderChunked(SOURCES_MD, SOURCES_MD.length, { customBlockTags: ['sources'] });
    for (const size of [1, 3, 7, 13]) {
      const chunked = renderChunked(SOURCES_MD, size, { customBlockTags: ['sources'] });
      expect(chunked).toBe(full);
    }
  });

  it('graceful degradation when stream ends without closing tag', () => {
    const partial = `<sources>\nSource: https://example.com\n`;
    const renderer = new MarkdownRenderer({ customBlockTags: ['sources'] });
    renderer.push(partial);
    renderer.flush();
    const html = renderer.currentHtml;
    // Should contain the opening tag content and auto-closed closing tag
    expect(html).toContain('<sources>');
  });

  it('does not affect unregistered tags', () => {
    const md = `<artifacts>\nsome content\n\nmore content\n</artifacts>`;
    // Without registration, blank line causes split — two commits
    const commits = splitterCommits(md, []);
    expect(commits.length).toBeGreaterThan(1);
  });

  it('supports multiple registered tags independently', () => {
    const md = `<sources>\nA\n\nB\n</sources>\n\n<artifacts>\nC\n\nD\n</artifacts>`;
    const commits = splitterCommits(md, ['sources', 'artifacts']);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toContain('<sources>');
    expect(commits[1]).toContain('<artifacts>');
  });

  it('tag matching is case-insensitive', () => {
    const md = `<Sources>\nSome content\n</Sources>`;
    const commits = splitterCommits(md, ['sources']);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toContain('<Sources>');
  });

  it('custom block preceded by paragraph commits paragraph first', () => {
    const md = `Some paragraph text\n<sources>\ndata\n</sources>`;
    const commits = splitterCommits(md, ['sources']);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toContain('Some paragraph text');
    expect(commits[1]).toContain('<sources>');
  });
});
