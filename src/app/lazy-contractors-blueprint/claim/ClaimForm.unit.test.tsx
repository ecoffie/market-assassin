// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ClaimForm from './ClaimForm';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); localStorage.clear(); });

describe('event claim form, signed out', () => {
  it('never promises a free account and points newcomers to the 14-day trial', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(<ClaimForm initialState="open" credits={1000} />); });
    const text = host.textContent || '';
    expect(text).toMatch(/Sign in to claim 1000 credits/);
    expect(text).not.toMatch(/free account/i);
    expect(text).toMatch(/start your 14-day free trial/);
    const trial = [...host.querySelectorAll('a')].find((a) => /14-day free trial/.test(a.textContent || ''));
    expect(trial?.getAttribute('href')).toBe('/pricing');
  });
});
