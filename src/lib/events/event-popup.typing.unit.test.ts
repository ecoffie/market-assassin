// @vitest-environment jsdom
/**
 * The event pop-up must never take a keystroke meant for the page. Found 2026-11-14 on production:
 * it opened 2.5 s after load while a customer was typing an Ask Mindy question and focused
 * "Register free", so pressing Enter to send navigated to the event page and the question was lost.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eventPopupScript } from './event-popup';

const BEFORE_EVENT = new Date('2026-11-14T12:00:00Z');
const run = () => new Function(eventPopupScript(BEFORE_EVENT))();
const popup = () => document.querySelector('.lcbp-ov');

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<textarea id="ask"></textarea><button id="btn">x</button>';
  document.cookie = 'mindy_lcb_popup_s=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  delete (window as unknown as { __lcbPop?: number }).__lcbPop;
  window.history.replaceState(null, '', '/app?panel=chat');
});
afterEach(() => { vi.useRealTimers(); });

describe('event pop-up never interrupts typing', () => {
  it('does not open while a text field is focused; opens after the visitor leaves it', () => {
    const ta = document.getElementById('ask') as HTMLTextAreaElement;
    ta.focus();
    run();
    vi.advanceTimersByTime(10_000);
    expect(popup()).toBeNull();
    expect(document.activeElement).toBe(ta);
    expect(document.cookie).not.toContain('mindy_lcb_popup_s=1'); // not "shown", so not spent
    (document.getElementById('btn') as HTMLButtonElement).focus(); // leaves the field
    vi.advanceTimersByTime(400);
    expect(popup()).not.toBeNull();
    expect(document.cookie).toContain('mindy_lcb_popup_s=1');
  });

  it('when it opens, focus is on the dialog, never on the Register link (a stray Enter cannot navigate)', () => {
    run();
    vi.advanceTimersByTime(2500);
    expect(popup()).not.toBeNull();
    expect(document.activeElement?.classList.contains('lcbp')).toBe(true);
    expect(document.activeElement?.tagName).not.toBe('A');
  });

  it('still opens on schedule for a visitor who is not typing (rule unchanged), once per session', () => {
    run();
    vi.advanceTimersByTime(2499);
    expect(popup()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(popup()).not.toBeNull();
    (popup() as HTMLElement).remove();
    delete (window as unknown as { __lcbPop?: number }).__lcbPop;
    run();
    vi.advanceTimersByTime(5000);
    expect(popup()).toBeNull(); // session cookie already set
  });

  it('Escape still closes it', () => {
    run();
    vi.advanceTimersByTime(2500);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(popup()).toBeNull();
  });
});

describe('review fixes', () => {
  it('does not open on an excluded page reached by client-side navigation while it waited', () => {
    (document.getElementById('ask') as HTMLTextAreaElement).focus();
    run();
    window.history.replaceState(null, '', '/signup');
    (document.getElementById('btn') as HTMLButtonElement).focus();
    vi.advanceTimersByTime(5000);
    expect(popup()).toBeNull();
  });
  it('opens when the focused field is removed without a blur event', () => {
    const ta = document.getElementById('ask') as HTMLTextAreaElement;
    ta.focus();
    run();
    vi.advanceTimersByTime(3000);
    expect(popup()).toBeNull();
    ta.remove();
    vi.advanceTimersByTime(2500);
    expect(popup()).not.toBeNull();
  });
});
