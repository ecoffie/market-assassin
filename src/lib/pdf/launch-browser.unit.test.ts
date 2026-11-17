/**
 * htmlToPdf `lockdown` — the document renderer's PDFs come from LLM/upload text, so the page must
 * run with JavaScript off and no network. A fake browser records what the page was told to do;
 * no Chromium is launched. (Real-browser behaviour is checked on the preview deployment.)
 */
import { describe, it, expect } from 'vitest';
import { htmlToPdf, isLockdownAllowedUrl, type InterceptedRequest, type LaunchedBrowser } from './launch-browser';

function fakeBrowser(opts: { lockdownApi?: boolean } = {}) {
  const log: string[] = [];
  let handler: ((r: InterceptedRequest) => void) | null = null;
  const page: Record<string, unknown> = {
    setContent: async () => { log.push('setContent'); },
    pdf: async () => { log.push('pdf'); return Buffer.from('%PDF-1.7 fake'); },
    setViewport: async () => {}, goto: async () => {}, screenshot: async () => Buffer.from(''), content: async () => '',
  };
  if (opts.lockdownApi !== false) {
    page.setJavaScriptEnabled = async (on: boolean) => { log.push(`js:${on}`); };
    page.setRequestInterception = async (on: boolean) => { log.push(`intercept:${on}`); };
    page.on = (event: string, h: (r: InterceptedRequest) => void) => { log.push(`on:${event}`); handler = h; };
  }
  const browser = { newPage: async () => page, close: async () => { log.push('close'); } } as unknown as LaunchedBrowser;
  const request = (url: string) => {
    const r = { outcome: '' };
    handler?.({ url: () => url, continue: () => { r.outcome = 'continue'; }, abort: () => { r.outcome = 'abort'; } });
    return r.outcome;
  };
  return { browser, log, request, hasHandler: () => handler !== null };
}

describe('isLockdownAllowedUrl', () => {
  it('allows only about:blank and data: URIs', () => {
    expect(isLockdownAllowedUrl('about:blank')).toBe(true);
    expect(isLockdownAllowedUrl('data:image/png;base64,AAAA')).toBe(true);
    for (const u of ['https://evil.example/x.png', 'http://169.254.169.254/latest/meta-data', 'file:///etc/passwd', 'blob:https://getmindy.ai/1', 'ws://x', 'about:srcdoc', ' data:x']) {
      expect(isLockdownAllowedUrl(u)).toBe(false);
    }
  });
});

describe('htmlToPdf lockdown', () => {
  it('lockdown: JavaScript off and interception on BEFORE the content loads; foreign requests aborted', async () => {
    const f = fakeBrowser();
    const r = await htmlToPdf('<p>x</p>', {}, { lockdown: true, launch: async () => f.browser });
    expect(r.error).toBeNull();
    expect(r.pdf?.subarray(0, 5).toString()).toBe('%PDF-');
    expect(f.log.slice(0, 4)).toEqual(['js:false', 'intercept:true', 'on:request', 'setContent']);
    expect(f.request('about:blank')).toBe('continue');
    expect(f.request('data:image/svg+xml,<svg/>')).toBe('continue');
    expect(f.request('https://evil.example/beacon?d=secret')).toBe('abort');
    expect(f.request('file:///etc/passwd')).toBe('abort');
    expect(f.log).toContain('close');
  });

  it('fails closed: a page that cannot be locked down produces no PDF', async () => {
    const f = fakeBrowser({ lockdownApi: false });
    const r = await htmlToPdf('<p>x</p>', {}, { lockdown: true, launch: async () => f.browser });
    expect(r.pdf).toBeNull();
    expect(r.error).toMatch(/lockdown_unsupported/);
    expect(f.log).not.toContain('pdf');
    expect(f.log).toContain('close');
  });

  it('default (other callers, e.g. the market-research export): behaviour unchanged — no lockdown calls', async () => {
    const f = fakeBrowser();
    const r = await htmlToPdf('<p>x</p>', undefined, { launch: async () => f.browser });
    expect(r.pdf).not.toBeNull();
    expect(f.log).toEqual(['setContent', 'pdf', 'close']);
    expect(f.hasHandler()).toBe(false);
  });
});
