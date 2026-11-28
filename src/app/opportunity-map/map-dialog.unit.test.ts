// @vitest-environment jsdom
/**
 * In-page dialogs replace browser pop-ups in the saved-search flows (Agent 4 assignment, Eric-approved,
 * 2026-11-28). Executes the real MAP_DIALOG_JS in jsdom and pins the keyboard contract (focus trap, Esc,
 * Enter), the wording, the Daily / Weekly / Off choice, and that the saved-search flows no longer call
 * window.prompt / confirm / alert.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAP_DIALOG_JS } from './map-dialog';

type Res = null | { value?: string; choice?: string };
type Dlg = (o: Record<string, unknown>, cb: (r: Res) => void) => void;
const dlg = () => (window as unknown as { __mdDialog: Dlg }).__mdDialog;
const key = (k: string, shift = false) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true }));
const box = () => document.querySelector('.md-box') as HTMLElement | null;

const FREQ = { label: 'Email alerts', value: 'daily', options: [{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'off', label: 'Off' }] };

beforeAll(() => { new Function(MAP_DIALOG_JS)(); });
beforeEach(() => { document.body.innerHTML = '<button id="opener">Save search</button>'; (document.getElementById('opener') as HTMLElement).focus(); });

describe('window.__mdDialog', () => {
  it('is an accessible modal: role, aria-modal, labelled and described', () => {
    dlg()({ title: 'Save this search', message: 'Mindy watches this market.', input: { label: 'Name', value: 'Cyber' } }, () => {});
    const b = box()!;
    expect(b.getAttribute('role')).toBe('dialog');
    expect(b.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(b.getAttribute('aria-labelledby')!)!.textContent).toBe('Save this search');
    expect(document.getElementById(b.getAttribute('aria-describedby')!)!.textContent).toBe('Mindy watches this market.');
    expect(document.activeElement).toBe(b.querySelector('input'));
    key('Escape');
  });

  it('Enter in the name field saves with the default frequency preselected', () => {
    let got: Res | undefined;
    dlg()({ title: 'Save', input: { label: 'Name', value: '  Cyber VA  ' }, choice: FREQ, okLabel: 'Save', cancelLabel: 'Cancel' }, (r) => { got = r; });
    expect(box()!.querySelector('[aria-checked="true"]')!.textContent).toBe('Daily');
    key('Enter');
    expect(got).toEqual({ value: 'Cyber VA', choice: 'daily' });
    expect(box()).toBeNull();
    expect(document.activeElement!.id).toBe('opener');
  });

  it('arrow keys move the frequency choice (radiogroup, roving tabindex) and the choice is returned', () => {
    let got: Res | undefined;
    dlg()({ title: 'Save', input: { label: 'Name', value: 'x' }, choice: FREQ }, (r) => { got = r; });
    const radios = Array.from(box()!.querySelectorAll('[role="radio"]')) as HTMLElement[];
    expect(box()!.querySelector('[role="radiogroup"]')).not.toBeNull();
    radios[0].focus();
    key('ArrowRight');
    expect(document.activeElement).toBe(radios[1]);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    key('ArrowRight'); key('ArrowRight'); // Off, then wraps to Daily
    key('ArrowLeft');                     // wraps back to Off
    expect(radios[2].getAttribute('aria-checked')).toBe('true');
    key('Enter');
    expect(got).toEqual({ value: 'x', choice: 'off' });
  });

  it('Esc cancels (null) and nothing else fires', () => {
    let got: Res | undefined = undefined; let n = 0;
    dlg()({ title: 'Delete?', okLabel: 'Delete', cancelLabel: 'Keep it', danger: true }, (r) => { got = r; n++; });
    key('Escape'); key('Escape');
    expect(got).toBeNull(); expect(n).toBe(1);
    expect(box()).toBeNull();
  });

  it('Tab and Shift+Tab stay inside the dialog', () => {
    dlg()({ title: 'Save', input: { label: 'Name', value: 'x' }, okLabel: 'Save', cancelLabel: 'Cancel' }, () => {});
    const [input, cancel, ok] = Array.from(box()!.querySelectorAll('input,button')) as HTMLElement[];
    ok.focus(); key('Tab');
    expect(document.activeElement).toBe(input);
    key('Tab', true);
    expect(document.activeElement).toBe(ok);
    expect(cancel.textContent).toBe('Cancel'); expect(ok.textContent).toBe('Save');
    key('Escape');
  });

  it('Enter on Cancel cancels instead of saving', () => {
    let got: Res | undefined;
    dlg()({ title: 'Save', input: { label: 'Name', value: 'x' } }, (r) => { got = r; });
    const cancel = box()!.querySelector('.md-btn:not(.md-ok)') as HTMLButtonElement;
    cancel.focus(); key('Enter'); // the browser then clicks the focused button
    cancel.click();
    expect(got).toBeNull();
  });

  it('an empty name cannot be saved', () => {
    let n = 0;
    dlg()({ title: 'Save', input: { label: 'Name', value: '   ' } }, () => { n++; });
    key('Enter');
    expect(n).toBe(0);
    expect(box()).not.toBeNull();
    key('Escape');
  });

  it('a destructive dialog uses the danger style and its own wording', () => {
    dlg()({ title: 'Delete this saved search?', okLabel: 'Delete', cancelLabel: 'Keep it', danger: true }, () => {});
    expect(box()!.querySelector('.md-danger')!.textContent).toBe('Delete');
    expect(document.activeElement!.textContent).toBe('Delete');
    key('Escape');
  });

  it('an information dialog has one button and ignores overlay clicks', () => {
    let got: Res | undefined;
    dlg()({ title: 'Couldn’t save', message: 'Check your connection.', okLabel: 'OK', hideCancel: true }, (r) => { got = r; });
    expect(box()!.querySelectorAll('button')).toHaveLength(1);
    (document.querySelector('.md-ov') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(box()).not.toBeNull();
    key('Enter');
    expect(got).toEqual({ value: undefined, choice: undefined });
  });
});

describe('the saved-search flows use the in-page dialog, not browser pop-ups', () => {
  const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
  const SAVED = readFileSync(join(__dirname, 'saved', 'route.ts'), 'utf8');
  const handler = MAP.slice(MAP.indexOf('  if(_ss)_ss.onclick=function(){'), MAP.indexOf('  // Apply a SAVED SEARCH to the map in-place'));

  it('Map Save search: no prompt / confirm / alert, and the dialog script ships before the handler', () => {
    expect(handler.length).toBeGreaterThan(1000);
    expect(handler).not.toMatch(/(^|[^.\w])(window\.)?(prompt|confirm|alert)\(/);
    expect(handler).toMatch(/window\.__mdDialog\(/);
    const inject = MAP.slice(MAP.indexOf('const bodyInject ='));
    expect(inject.indexOf('MAP_DIALOG_SCRIPT')).toBeGreaterThan(-1);
    expect(inject.indexOf('MAP_DIALOG_SCRIPT')).toBeLessThan(inject.indexOf('VIEWPORT_JS'));
  });

  it('Saved Searches page: rename and delete use the dialog', () => {
    expect(SAVED).not.toMatch(/(^|[^.\w])(window\.)?(prompt|confirm)\(/);
    expect(SAVED).toMatch(/title:'Rename saved search'/);
    expect(SAVED).toMatch(/okLabel:'Delete',cancelLabel:'Keep it',danger:true/);
    expect(SAVED).toContain('${MAP_DIALOG_SCRIPT}');
  });

  it('the dialog source is plain ES5 (no arrow functions, let/const, backticks or template placeholders)', () => {
    expect(MAP_DIALOG_JS).not.toMatch(/=>|\blet\s|\bconst\s|`|\$\{/);
  });
});
