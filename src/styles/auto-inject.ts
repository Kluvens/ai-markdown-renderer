/**
 * Auto-injects the default stylesheet into the document <head> once,
 * as a side effect of importing the React adapter.
 *
 * The CSS is inlined at build time by tsup's text loader so no network
 * request is needed. Safe to call in SSR environments — the injection is
 * skipped when `document` is not available.
 */
import css from './default.css';

let injected = false;

export function injectDefaultStyles(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;

  // Skip if already present (e.g. duplicate module instances in the same page)
  if (document.querySelector('style[data-ai-markdown]')) return;

  const el = document.createElement('style');
  el.setAttribute('data-ai-markdown', '');
  el.textContent = css;
  document.head.appendChild(el);
}

// Side-effect: inject on import.
injectDefaultStyles();
