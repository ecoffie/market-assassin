/**
 * StateBlock — one shared look for a page that has nothing to show yet (Design & Output, 2026-11-22).
 *
 * The Opportunity Map sub-pages are string-built HTML (route handlers), so this is a string helper, not a
 * React component. A state says what the page is for and offers the ONE next action, instead of a bare
 * sentence. This PR applies the signed-out state only; empty / error / loading states reuse the same block.
 */
import { PRODUCT_TOKENS as T } from './tokens';

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Styles for .mstate, built from the product tokens. Include once per page, after the page's own styles. */
export const STATE_BLOCK_CSS = `
.mstate{max-width:440px;margin:56px auto;padding:0 20px;text-align:center;font-family:${T.fontSans}}
.mstate h2{margin:0 0 8px;font:600 18px/1.35 ${T.fontSans};color:${T.ink}}
.mstate p{margin:0 0 20px;font:400 14.5px/1.55 ${T.fontSans};color:${T.muted}}
.mstate .mstate-act{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 20px;border:0;border-radius:8px;background:${T.action};color:#fff;font:600 14.5px/1 ${T.fontSans};text-decoration:none;cursor:pointer}
.mstate .mstate-act:hover{background:${T.actionHover}}
.mstate .mstate-act:focus-visible{outline:2px solid ${T.action};outline-offset:3px}
`;

export interface SignedOutState {
  /** What the page is, e.g. "Your pursuits". */
  title: string;
  /** One sentence: what the visitor gets once signed in. */
  body: string;
  /** Button label. Defaults to "Sign in". */
  action?: string;
}

/**
 * The signed-out block. The button calls the page's existing window.__mapsSignIn() (the sign-in modal,
 * falling back to /app), exactly what the old inline "sign in" link did.
 */
export function signedOutStateHtml({ title, body, action = 'Sign in' }: SignedOutState): string {
  return `<div class="mstate" role="status"><h2>${esc(title)}</h2><p>${esc(body)}</p>`
    + `<button type="button" class="mstate-act" onclick="return window.__mapsSignIn()">${esc(action)}</button></div>`;
}
