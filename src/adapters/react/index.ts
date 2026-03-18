// Auto-inject default styles when the React adapter is imported.
// Users can suppress this by importing from the sub-paths directly
// (e.g. useMarkdownStream, MarkdownStream) rather than this index.
import '../../styles/auto-inject.js';

export { AIMarkdown } from './AIMarkdown.js';
export { useMarkdownStream } from './useMarkdownStream.js';
export { MarkdownStream } from './MarkdownStream.js';
export type { AIMarkdownProps, MarkdownComponents } from './AIMarkdown.js';
export type { UseMarkdownStreamOptions, UseMarkdownStreamReturn } from './useMarkdownStream.js';
export type { MarkdownStreamProps } from './MarkdownStream.js';
