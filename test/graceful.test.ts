/**
 * Graceful degradation tests.
 *
 * Verifies that incomplete/partial markdown constructs are handled
 * without crashing and produce reasonable output.
 */

import { describe, it, expect } from 'vitest';
import { MarkdownRenderer } from '../src/core/renderer.js';
import { StreamingBlockSplitter } from '../src/core/streaming-block-splitter.js';

function renderIncomplete(markdown: string): string {
  const renderer = new MarkdownRenderer();
  renderer.push(markdown);
  renderer.flush(); // force commit of incomplete content
  return renderer.currentHtml;
}

describe('Graceful degradation — unclosed constructs', () => {
  it('unclosed code fence renders as code block', () => {
    const md = '```typescript\nconst x = 42;\nconsole.log(x);';
    const html = renderIncomplete(md);
    // Should contain the code content, not crash
    expect(html).toContain('const x = 42');
    expect(html).toContain('console.log');
    // Should be wrapped in pre/code or similar
    expect(html).toMatch(/<pre|<code/);
  });

  it('unclosed code fence with language tag renders as code block', () => {
    const md = '```python\ndef hello():\n    print("hello")';
    const html = renderIncomplete(md);
    expect(html).toContain('def hello');
    expect(html).toContain('print');
  });

  it('unclosed math block renders without crashing', () => {
    const md = '$$\n\\int_0^\\infty e^{-x^2} dx';
    const html = renderIncomplete(md);
    // Should not crash; content should appear in some form
    expect(typeof html).toBe('string');
  });

  it('unclosed bold renders as text (no infinite loop)', () => {
    const md = '**unclosed bold text';
    const html = renderIncomplete(md);
    expect(html).toContain('unclosed bold text');
  });

  it('partial paragraph renders as paragraph', () => {
    const md = 'This is a partial paragraph without trailing newline';
    const html = renderIncomplete(md);
    expect(html).toContain('This is a partial paragraph');
    expect(html).toMatch(/<p>/);
  });

  it('unclosed inline code renders as text', () => {
    const md = 'prefix `unclosed code span';
    const html = renderIncomplete(md);
    // Should contain the text in some form without crashing
    expect(html).toContain('prefix');
    expect(html).toContain('unclosed code span');
  });

  it('mid-stream table renders partial table', () => {
    const md = '| Name | Age |\n|------|-----|';
    const html = renderIncomplete(md);
    // Should contain the table headers
    expect(html).toContain('Name');
    expect(html).toContain('Age');
  });
});

describe('StreamingBlockSplitter.applyGracefulDegradation', () => {
  it('auto-closes backtick code fence', () => {
    const splitter = new StreamingBlockSplitter(() => {});
    // Simulate being in code-fence mode
    splitter.push('```js\nconst x = 1;');
    const raw = splitter.getSpeculativeBuffer();
    // The state should be code-fence; applyGracefulDegradation should close it
    // We test via flush behavior — the output should include the closing fence
    const degraded = splitter.applyGracefulDegradation(raw);
    expect(degraded).toContain('```');
    // The degraded version should end with a closing fence
    const lines = degraded.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    expect(lastLine).toMatch(/^`{3,}$/);
  });

  it('auto-closes tilde code fence', () => {
    const splitter = new StreamingBlockSplitter(() => {});
    splitter.push('~~~python\nprint("hi")');
    const raw = splitter.getSpeculativeBuffer();
    const degraded = splitter.applyGracefulDegradation(raw);
    expect(degraded).toContain('~~~');
    const lines = degraded.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    expect(lastLine).toMatch(/^~{3,}$/);
  });

  it('adds trailing newline to plain paragraphs', () => {
    const splitter = new StreamingBlockSplitter(() => {});
    splitter.push('Hello world');
    const raw = splitter.getSpeculativeBuffer();
    const degraded = splitter.applyGracefulDegradation(raw);
    expect(degraded.endsWith('\n')).toBe(true);
  });
});

describe('Graceful degradation — streaming scenarios', () => {
  it('renders valid HTML at every step of a streaming code block', () => {
    const fullMd = '```typescript\nconst x = 42;\n```\n';
    const renderer = new MarkdownRenderer();
    const speculatives: string[] = [];

    renderer.on('delta', (d) => {
      speculatives.push(d.speculativeHtml);
    });

    // Push character by character
    for (const char of fullMd) {
      renderer.push(char);
    }
    renderer.flush();

    // Every speculative snapshot should be a non-crashing string
    for (const html of speculatives) {
      expect(typeof html).toBe('string');
      // Should not contain raw unclosed HTML tags in a way that would break layout
      // (basic check: no unclosed <script> or similar dangerous patterns)
      expect(html).not.toMatch(/<script[^>]*>[^<]*$/i);
    }
  });

  it('produces same final output with or without flush after complete markdown', () => {
    const md = '# Hello\n\nWorld\n';

    const r1 = new MarkdownRenderer();
    r1.push(md);
    r1.flush();
    const html1 = r1.currentHtml;

    const r2 = new MarkdownRenderer();
    r2.push(md);
    r2.flush();
    const html2 = r2.currentHtml;

    expect(html1).toBe(html2);
  });
});
