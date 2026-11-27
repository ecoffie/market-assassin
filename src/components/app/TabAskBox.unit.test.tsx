// @vitest-environment jsdom
/**
 * The shared Ask Mindy box: question → the adapter's params → the caller's own load; one summary line
 * with Clear; a question the tab can't express shows why and hands off to chat (never a guess).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import TabAskBox from './TabAskBox';
import { forecastsAskAdapter, type ForecastsAskParams } from '@/lib/app/tab-ask-adapters/forecasts';
import { CHAT_SEED_KEY, TAB_ASK_CHAT_EVENT, type TabAskCount } from '@/lib/app/tab-ask';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); sessionStorage.clear(); });

const $ = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

function type(value: string) {
  const input = $('tab-ask-input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function submit() {
  await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
}

function mount(count: TabAskCount = { shown: 14, more: false }, onAskInChat?: (q: string) => void) {
  const onAsk = vi.fn<(p: ForecastsAskParams) => Promise<TabAskCount>>(async () => count);
  const onClear = vi.fn();
  act(() => root.render(<TabAskBox adapter={forecastsAskAdapter} onAsk={onAsk} onClear={onClear} onAskInChat={onAskInChat} />));
  return { onAsk, onClear };
}

describe('TabAskBox', () => {
  it('renders an accessible search form with a labelled input and up to 3 example chips', () => {
    mount();
    const input = $('tab-ask-input') as HTMLInputElement;
    expect(host.querySelector('form[role="search"]')).not.toBeNull();
    expect(host.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('Ask Mindy');
    expect(host.querySelectorAll('[data-testid="tab-ask-example"]').length).toBeGreaterThanOrEqual(2);
    expect(host.querySelectorAll('[data-testid="tab-ask-example"]').length).toBeLessThanOrEqual(3);
    expect(($('tab-ask-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('submits the tab\'s params to the caller, then shows what Mindy searched with Clear', async () => {
    const { onAsk, onClear } = mount();
    type('Navy cybersecurity');
    await submit();
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk.mock.calls[0][0]).toEqual({ naics: '', agency: 'NAVY', search: 'cybersecurity', state: '', setAside: '' });
    expect($('tab-ask-summary')?.textContent).toContain('Mindy searched: Navy · cybersecurity — 14 upcoming buys');
    act(() => { ($('tab-ask-clear') as HTMLButtonElement).click(); });
    expect(onClear).toHaveBeenCalledTimes(1);
    expect($('tab-ask-summary')).toBeNull();
    expect(($('tab-ask-input') as HTMLInputElement).value).toBe('');
  });

  it('an example chip asks right away', async () => {
    const { onAsk } = mount();
    await act(async () => { ($('tab-ask-example') as HTMLButtonElement).click(); });
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect($('tab-ask-summary')).not.toBeNull();
  });

  it('a failed load reads "unavailable", never 0', async () => {
    mount(null);
    type('Navy cybersecurity');
    await submit();
    const text = $('tab-ask-summary')?.textContent || '';
    expect(text).toContain('count unavailable');
    expect(text).not.toMatch(/\b0\b/);
  });

  it('a question the tab can\'t express never loads the list: it offers chat with the question', async () => {
    const chat = vi.fn();
    const { onAsk } = mount(undefined, chat);
    type('how do I win navy work');
    await submit();
    expect(onAsk).not.toHaveBeenCalled();
    expect($('tab-ask-summary')).toBeNull();
    expect($('tab-ask-handoff')?.textContent).toContain('Ask Mindy in chat instead');
    act(() => { ($('tab-ask-chat') as HTMLButtonElement).click(); });
    expect(chat).toHaveBeenCalledWith('how do I win navy work');
  });

  it('the default handoff seeds the chat panel and asks the app to open it', async () => {
    const heard = vi.fn();
    window.addEventListener(TAB_ASK_CHAT_EVENT, heard);
    mount();
    type('cloud, cyber at DHS');
    await submit();
    act(() => { ($('tab-ask-chat') as HTMLButtonElement).click(); });
    expect(sessionStorage.getItem(CHAT_SEED_KEY)).toBe('cloud, cyber at DHS');
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(TAB_ASK_CHAT_EVENT, heard);
  });
});
