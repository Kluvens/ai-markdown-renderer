/**
 * StreamingBlockSplitter — the core O(n) differentiator.
 *
 * Maintains parse state across arbitrary chunk boundaries and emits
 * complete "stable" block strings when a commitment boundary is detected.
 * Each character of input is examined exactly once.
 *
 * KEY DESIGN: `push()` only processes NEW complete lines from each chunk.
 * It does NOT re-process previously seen content. This is critical for
 * correctness: without this, a code fence's opening ``` would be re-seen
 * as a closing ``` on every subsequent push, prematurely committing blocks.
 *
 * Fields:
 *   state.speculativeBuffer — accumulated raw markdown of the current
 *     in-progress block (complete lines only).
 *   linePending — the current partial (no-newline-yet) line.
 *
 *   getSpeculativeBuffer() returns speculativeBuffer + linePending,
 *   which is the full current block for display purposes.
 *
 * Commitment triggers:
 *   - Blank line      → commits paragraph / blockquote / list
 *   - ATX heading     → commits previous block, then immediately commits heading
 *   - Closing fence   → commits code block (``` or ~~~, must match opener)
 *   - Closing $$      → commits math block
 *   - flush()         → commits everything with graceful degradation
 *   - Buffer overflow → force-commits with auto-close
 */

import type { BlockMode, CodeFenceMeta, ParseState } from './types.js';

export type CommitCallback = (rawBlock: string) => void;

const DEFAULT_BUFFER_LIMIT = 8192;

const ATX_HEADING_RE = /^#{1,6}(?:\s|$)/;
const CODE_FENCE_RE = /^(`{3,}|~{3,})(.*)/;
const MATH_BLOCK_RE = /^\$\$\s*$/;
const BLANK_LINE_RE = /^\s*$/;
const TABLE_ROW_RE = /^\|/;
const TABLE_SEP_RE = /^\|[-| :]+\|/;
const THINK_OPEN_RE = /^<think\b[^>]*>/i;
const THINK_CLOSE_RE = /^<\/think\s*>/i;

export class StreamingBlockSplitter {
  private state: ParseState;
  private readonly bufferLimit: number;
  private readonly onCommit: CommitCallback;
  /** Current partial line that has no newline yet. */
  private linePending = '';
  /** Regex that matches the opening of any registered custom block tag. */
  private readonly customOpenRe: RegExp | null;
  /** Map from tag name → closing regex, built once from customBlockTags. */
  private readonly customCloseRe: Map<string, RegExp>;

  constructor(onCommit: CommitCallback, bufferLimit = DEFAULT_BUFFER_LIMIT, customBlockTags: string[] = []) {
    this.onCommit = onCommit;
    this.bufferLimit = bufferLimit;

    if (customBlockTags.length > 0) {
      const escaped = customBlockTags.map((t) => escapeRegex(t)).join('|');
      this.customOpenRe = new RegExp(`^<(${escaped})\\b[^>]*>`, 'i');
      this.customCloseRe = new Map(
        customBlockTags.map((t) => [
          t.toLowerCase(),
          new RegExp(`^<\\/${escapeRegex(t)}\\s*>`, 'i'),
        ]),
      );
    } else {
      this.customOpenRe = null;
      this.customCloseRe = new Map();
    }

    this.state = this.makeInitialState();
  }

  private makeInitialState(): ParseState {
    return {
      mode: 'normal',
      speculativeBuffer: '',
      committedHtmlParts: [],
      codeFenceMeta: null,
      customBlockTag: null,
      nestingDepth: 0,
      version: 0,
    };
  }

  get currentState(): Readonly<ParseState> {
    return this.state;
  }

  /**
   * Feed a new chunk of text from the LLM stream.
   * Only processes NEW complete lines — never re-processes previously seen content.
   */
  push(chunk: string): void {
    this.linePending += chunk;

    // Extract all complete lines (ending with \n) from linePending
    const lastNl = this.linePending.lastIndexOf('\n');
    if (lastNl === -1) {
      // No complete line yet
      this.checkOverflow();
      return;
    }

    const completeLines = this.linePending.slice(0, lastNl + 1);
    this.linePending = this.linePending.slice(lastNl + 1);

    // Process only the newly complete lines
    this.processLines(completeLines);
    this.checkOverflow();
  }

  /**
   * Signal end of stream. Commits all remaining content with graceful degradation.
   */
  flush(): void {
    // Include any pending partial line in the tail
    const tail = this.getSpeculativeBuffer();
    if (!tail.trim() && this.state.mode === 'normal') return;

    const graceful = this.applyGracefulDegradation(tail);
    if (graceful.trim()) {
      this.commit(graceful);
    }
    this.state.speculativeBuffer = '';
    this.linePending = '';
    this.state.mode = 'normal';
    this.state.codeFenceMeta = null;
    this.state.customBlockTag = null;
  }

  /**
   * Reset to initial state for reuse.
   */
  reset(): void {
    this.state = this.makeInitialState();
    this.linePending = '';
    // customBlockTag is part of state, reset via makeInitialState — nothing extra needed
  }

  /**
   * Returns the full current speculative block content for display:
   * the accumulated complete lines + any trailing partial line.
   */
  getSpeculativeBuffer(): string {
    return this.state.speculativeBuffer + this.linePending;
  }

  /**
   * Returns the current partial line that hasn't yet ended with a newline.
   * Used by SpeculativeRenderer to suppress partial inline math tokens.
   */
  get pendingLine(): string {
    return this.linePending;
  }

  // ---------------------------------------------------------------------------
  // Private: line-by-line processing
  // ---------------------------------------------------------------------------

  private processLines(text: string): void {
    // Split on \n, keeping the delimiter on each line
    const lines = text.split('\n');
    // All segments except the last have a \n to add back;
    // the last segment is empty because text ends with \n.
    for (let i = 0; i < lines.length - 1; i++) {
      this.processLine((lines[i] ?? '') + '\n');
    }
    // If there's a non-empty final segment, it's a partial line without \n.
    // (Shouldn't happen given we only pass content up to the last \n, but be safe.)
    const last = lines[lines.length - 1];
    if (last) {
      this.linePending += last;
    }
  }

  private processLine(line: string): void {
    const trimmed = line.trimEnd();
    const { mode } = this.state;

    // ---- Inside a code fence: only look for closing fence ----
    if (mode === 'code-fence') {
      this.state.speculativeBuffer += line;
      const meta = this.state.codeFenceMeta!;
      const closingFenceRe = new RegExp(
        `^${meta.char === '`' ? '`' : '~'}{${meta.length},}\\s*$`,
      );
      if (closingFenceRe.test(trimmed)) {
        this.commitBuffer();
        this.state.mode = 'normal';
        this.state.codeFenceMeta = null;
      }
      return;
    }

    // ---- Inside a math block: only look for closing $$ ----
    if (mode === 'math-block') {
      this.state.speculativeBuffer += line;
      if (MATH_BLOCK_RE.test(trimmed)) {
        this.commitBuffer();
        this.state.mode = 'normal';
      }
      return;
    }

    // ---- Inside a think block: only look for closing </think> ----
    if (mode === 'think-block') {
      this.state.speculativeBuffer += line;
      if (THINK_CLOSE_RE.test(trimmed)) {
        this.commitBuffer();
        this.state.mode = 'normal';
      }
      return;
    }

    // ---- Inside a custom block: only look for its closing tag ----
    if (mode === 'custom-block') {
      this.state.speculativeBuffer += line;
      const closeRe = this.customCloseRe.get(this.state.customBlockTag ?? '');
      if (closeRe?.test(trimmed)) {
        this.commitBuffer();
        this.state.mode = 'normal';
        this.state.customBlockTag = null;
      }
      return;
    }

    // ---- Blank line: commits most block types ----
    if (BLANK_LINE_RE.test(trimmed)) {
      if (mode !== 'normal') {
        this.commitBuffer();
        this.state.mode = 'normal';
        this.state.nestingDepth = 0;
      }
      return;
    }

    // ---- ATX Heading: commits previous block, then heading itself ----
    if (ATX_HEADING_RE.test(trimmed) && mode !== 'blockquote' && mode !== 'list') {
      if (this.state.speculativeBuffer.trim()) {
        this.commitBuffer();
      }
      this.state.speculativeBuffer = line;
      this.commitBuffer();
      this.state.mode = 'normal';
      return;
    }

    // ---- Code fence opening ----
    const fenceMatch = CODE_FENCE_RE.exec(trimmed);
    if (fenceMatch && mode !== 'blockquote' && mode !== 'list') {
      if (this.state.speculativeBuffer.trim()) {
        this.commitBuffer();
      }
      const fenceStr = fenceMatch[1]!;
      this.state.codeFenceMeta = {
        char: fenceStr[0] as '`' | '~',
        length: fenceStr.length,
        lang: (fenceMatch[2] ?? '').trim(),
      };
      this.state.speculativeBuffer = line;
      this.state.mode = 'code-fence';
      return;
    }

    // ---- Math block opening ($$ on its own line) ----
    if (MATH_BLOCK_RE.test(trimmed) && mode !== 'blockquote' && mode !== 'list') {
      if (this.state.speculativeBuffer.trim()) {
        this.commitBuffer();
      }
      this.state.speculativeBuffer = line;
      this.state.mode = 'math-block';
      return;
    }

    // ---- Think block opening (<think>) ----
    if (THINK_OPEN_RE.test(trimmed) && mode !== 'blockquote' && mode !== 'list') {
      if (this.state.speculativeBuffer.trim()) {
        this.commitBuffer();
      }
      this.state.speculativeBuffer = line;
      this.state.mode = 'think-block';
      return;
    }

    // ---- Custom block opening (user-registered tags) ----
    if (this.customOpenRe && mode !== 'blockquote' && mode !== 'list') {
      const match = this.customOpenRe.exec(trimmed);
      if (match) {
        if (this.state.speculativeBuffer.trim()) {
          this.commitBuffer();
        }
        this.state.speculativeBuffer = line;
        this.state.mode = 'custom-block';
        this.state.customBlockTag = match[1]!.toLowerCase();
        return;
      }
    }

    // ---- Blockquote ----
    if (trimmed.startsWith('>')) {
      if (mode !== 'blockquote') {
        if (this.state.speculativeBuffer.trim()) {
          this.commitBuffer();
        }
        this.state.mode = 'blockquote';
      }
      this.state.speculativeBuffer += line;
      return;
    }

    // ---- List item ----
    if (isListItem(trimmed)) {
      if (mode !== 'list') {
        if (this.state.speculativeBuffer.trim()) {
          this.commitBuffer();
        }
        this.state.mode = 'list';
      }
      this.state.speculativeBuffer += line;
      return;
    }

    // ---- List continuation (indented) ----
    if (mode === 'list' && (line.startsWith('  ') || line.startsWith('\t'))) {
      this.state.speculativeBuffer += line;
      return;
    }

    // ---- Table ----
    if (TABLE_ROW_RE.test(trimmed) || TABLE_SEP_RE.test(trimmed)) {
      if (mode !== 'table') {
        if (mode !== 'paragraph') {
          if (this.state.speculativeBuffer.trim()) {
            this.commitBuffer();
          }
        }
        this.state.mode = 'table';
      }
      this.state.speculativeBuffer += line;
      return;
    }

    // ---- Non-table line after table ----
    if (mode === 'table') {
      this.commitBuffer();
      this.state.mode = 'paragraph';
      this.state.speculativeBuffer = line;
      return;
    }

    // ---- Default: paragraph ----
    if (mode === 'normal') {
      this.state.mode = 'paragraph';
    }
    this.state.speculativeBuffer += line;
  }

  // ---------------------------------------------------------------------------
  // Private: commitment helpers
  // ---------------------------------------------------------------------------

  private commitBuffer(): void {
    const raw = this.state.speculativeBuffer;
    if (raw.trim()) {
      this.commit(raw);
    }
    this.state.speculativeBuffer = '';
  }

  private commit(rawBlock: string): void {
    this.state.version++;
    this.onCommit(rawBlock);
  }

  private checkOverflow(): void {
    if (this.getSpeculativeBuffer().length > this.bufferLimit) {
      const graceful = this.applyGracefulDegradation(this.getSpeculativeBuffer());
      this.commit(graceful);
      this.state.speculativeBuffer = '';
      this.linePending = '';
      this.state.mode = 'normal';
      this.state.codeFenceMeta = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Graceful degradation
  // ---------------------------------------------------------------------------

  /**
   * Returns a "completed" version of the raw buffer suitable for markdown-it.
   * Does NOT modify state.
   */
  applyGracefulDegradation(raw: string): string {
    const { mode, codeFenceMeta } = this.state;

    if (mode === 'code-fence' && codeFenceMeta) {
      const closingFence = codeFenceMeta.char.repeat(codeFenceMeta.length);
      const needsNewline = raw.length > 0 && !raw.endsWith('\n');
      return raw + (needsNewline ? '\n' : '') + closingFence + '\n';
    }

    if (mode === 'math-block') {
      const needsNewline = raw.length > 0 && !raw.endsWith('\n');
      return raw + (needsNewline ? '\n' : '') + '$$\n';
    }

    if (mode === 'think-block') {
      const needsNewline = raw.length > 0 && !raw.endsWith('\n');
      return raw + (needsNewline ? '\n' : '') + '</think>\n';
    }

    if (mode === 'custom-block' && this.state.customBlockTag) {
      const needsNewline = raw.length > 0 && !raw.endsWith('\n');
      return raw + (needsNewline ? '\n' : '') + `</${this.state.customBlockTag}>\n`;
    }

    if (raw.length > 0 && !raw.endsWith('\n')) {
      return raw + '\n';
    }

    return raw;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isListItem(trimmed: string): boolean {
  if (/^[-*+]\s/.test(trimmed)) return true;
  if (/^\d+[.)]\s/.test(trimmed)) return true;
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
