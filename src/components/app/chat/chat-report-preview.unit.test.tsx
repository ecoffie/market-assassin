/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatReportPreview, previewCandidates } from './ChatReportPreview';

const fetchMock = vi.fn();
vi.mock('@/components/app/authHeaders', () => ({
  authedFetch: (...args: unknown[]) => fetchMock(...args),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DOCX = '11111111-1111-4111-8111-111111111111';
const PDF = '11111111-1111-4111-8111-111111111112';
const RICH_HTML = '<!doctype html><h2>The read</h2><p>Pathways first</p><table><tr><td>Federal Highway Administration</td></tr></table>';

const json = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

describe('previewCandidates', () => {
  it('prefers Word, then PDF, and skips entries without an id', () => {
    expect(previewCandidates([
      { format: 'pdf', document_id: PDF },
      { format: 'docx', document_id: DOCX },
      { format: 'pdf', document_id: '' },
    ])).toEqual([DOCX, PDF]);
  });
});

describe('ChatReportPreview', () => {
  beforeEach(() => { fetchMock.mockReset(); document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

  async function mount(props: Parameters<typeof ChatReportPreview>[0]) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(<ChatReportPreview {...props} />); });
    await act(async () => { await Promise.resolve(); });
    return el;
  }

  it('fetches THIS turn\'s document and shows the rendered report in a sandboxed iframe', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { success: true, html: RICH_HTML, title: 'RBA Federal Market Profile', version: 1 }));
    const el = await mount({ email: 'o@x.com', files: [{ format: 'pdf', document_id: PDF }, { format: 'docx', document_id: DOCX }] });

    expect(String(fetchMock.mock.calls[0][0])).toContain(`/api/app/vault/documents/preview?email=o%40x.com&id=${DOCX}`);
    const frame = el.querySelector('[data-testid="chat-report-frame"]') as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('The read');
    expect(el.querySelector('[data-testid="chat-report-title"]')?.textContent).toBe('RBA Federal Market Profile');
    // Claude/ChatGPT: one Export control in the pane header — formats are not listed under the answer.
    expect(el.querySelector('[data-testid="export-toggle"]')?.textContent).toMatch(/Export/);
    expect(el.querySelector('[data-testid="download-pdf"]')).toBeNull();
  });

  it('falls through to the next saved format when the first row is gone', async () => {
    fetchMock
      .mockResolvedValueOnce(json(404, { success: false }))
      .mockResolvedValueOnce(json(200, { success: true, html: RICH_HTML, title: 'T', version: 2 }));
    const el = await mount({ email: 'o@x.com', files: [{ format: 'docx', document_id: DOCX }, { format: 'pdf', document_id: PDF }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[data-testid="chat-report-frame"]')).toBeTruthy();
  });

  it('every row gone → an honest "no longer available", never a blank frame', async () => {
    fetchMock.mockResolvedValue(json(404, { success: false }));
    const el = await mount({ email: 'o@x.com', files: [{ format: 'docx', document_id: DOCX }] });
    expect(el.querySelector('[data-testid="chat-report-frame"]')).toBeNull();
    expect(el.querySelector('[data-testid="chat-report-gone"]')?.textContent).toMatch(/no longer available/i);
  });

  it('a server error shows a retry, not a fabricated report', async () => {
    fetchMock.mockResolvedValue(json(500, {}));
    const el = await mount({ email: 'o@x.com', files: [{ format: 'docx', document_id: DOCX }] });
    expect(el.querySelector('[data-testid="chat-report-error"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="chat-report-frame"]')).toBeNull();
  });

  it('a saved document says where it lives: "Saved to My Documents" links to Vault → Documents, even if the preview fails', async () => {
    fetchMock.mockResolvedValue(json(500, {}));
    const el = await mount({ email: 'o@x.com', files: [{ format: 'pdf', document_id: PDF }] });
    const a = el.querySelector('[data-testid="chat-report-my-documents"]') as HTMLAnchorElement;
    expect(a.textContent).toBe('Saved to My Documents');
    expect(a.getAttribute('href')).toBe('/app?panel=vault&section=documents');
  });

  it('with in-app navigation, the link opens My Documents without a page load', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { success: true, html: RICH_HTML, title: 'T', version: 1 }));
    const onOpenDocuments = vi.fn();
    const el = await mount({ email: 'o@x.com', files: [{ format: 'docx', document_id: DOCX }], onOpenDocuments });
    const a = el.querySelector('[data-testid="chat-report-my-documents"]') as HTMLAnchorElement;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => { a.dispatchEvent(ev); });
    expect(onOpenDocuments).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('a packaged market report (not a Vault document) has no My Documents link', async () => {
    const el = await mount({ email: 'o@x.com', inline: { html: RICH_HTML, title: 'Acme', url: null } });
    expect(el.querySelector('[data-testid="chat-report-my-documents"]')).toBeNull();
  });

  it('a packaged market report renders its inline HTML with no fetch', async () => {
    const el = await mount({ email: 'o@x.com', inline: { html: RICH_HTML, title: 'Acme market report', url: 'https://getmindy.ai/reports/abc' } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((el.querySelector('[data-testid="chat-report-frame"]') as HTMLIFrameElement).getAttribute('srcdoc')).toContain('The read');
    expect(el.querySelector('a[href="https://getmindy.ai/reports/abc"]')).toBeTruthy();
  });
});

// Standalone Ask Mindy milestone (2026-11-25): a packaged market report must open, export as a PDF and come
// back when the conversation is reopened. History keeps only its id and title; the pane re-reads the hosted
// page /reports/<id> (no auth), and Download PDF is a real link to /reports/<id>/pdf in a new tab.
describe('ChatReportPreview: packaged market report export and reopen', () => {
  const REPORT_ID = 'Ej6xTestReportId0000a';
  const HOSTED = '<!doctype html><html><body><h2>Facilities maintenance</h2><p>HOSTED REPORT BODY</p></body></html>';
  const realFetch = globalThis.fetch;
  const pageFetch = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); pageFetch.mockReset(); document.body.innerHTML = ''; (globalThis as { fetch: unknown }).fetch = pageFetch; });
  afterEach(() => { document.body.innerHTML = ''; (globalThis as { fetch: unknown }).fetch = realFetch; });

  async function mount(props: Parameters<typeof ChatReportPreview>[0]) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(<ChatReportPreview {...props} />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    return el;
  }
  const pdfLink = (el: HTMLElement) => el.querySelector('[data-testid="chat-report-pdf"]') as HTMLAnchorElement | null;

  it('a live report with a saved id offers Download PDF as a real link that opens a new tab', async () => {
    const el = await mount({ email: 'o@x.com', inline: { html: HOSTED, title: 'Facilities maintenance', url: `https://getmindy.ai/reports/${REPORT_ID}`, reportId: REPORT_ID } });
    const a = pdfLink(el)!;
    expect(a.getAttribute('href')).toBe(`/reports/${REPORT_ID}/pdf`);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener');
    expect(a.hasAttribute('download')).toBe(false); // an error page must never be saved as a PDF
    expect(a.getAttribute('title')).toBe('Opens in a new tab');
    expect(a.textContent).toBe('Download PDF');
    expect(pageFetch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a live report that was NOT saved (no id) offers no PDF, and a malformed id is ignored', async () => {
    const a = await mount({ email: 'o@x.com', inline: { html: HOSTED, title: 'T', url: null, reportId: null } });
    expect(pdfLink(a)).toBeNull();
    const b = await mount({ email: 'o@x.com', inline: { html: HOSTED, title: 'T', url: null, reportId: '../admin' } });
    expect(pdfLink(b)).toBeNull();
  });

  it('a reopened conversation re-reads the hosted report and shows it with Download PDF and the hosted link', async () => {
    pageFetch.mockResolvedValueOnce({ status: 200, ok: true, text: async () => HOSTED });
    const el = await mount({ email: 'o@x.com', savedReport: { id: REPORT_ID, title: 'Facilities maintenance' } });
    expect(pageFetch.mock.calls.map((c) => String(c[0]))).toEqual([`/reports/${REPORT_ID}`]);
    expect(fetchMock).not.toHaveBeenCalled(); // not the Vault preview route
    const frame = el.querySelector('[data-testid="chat-report-frame"]') as HTMLIFrameElement;
    expect(frame.getAttribute('srcdoc')).toContain('HOSTED REPORT BODY');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(el.querySelector('[data-testid="chat-report-title"]')?.textContent).toBe('Facilities maintenance');
    expect(pdfLink(el)?.getAttribute('href')).toBe(`/reports/${REPORT_ID}/pdf`);
    expect([...el.querySelectorAll('a')].some((x) => x.getAttribute('href') === `/reports/${REPORT_ID}` && x.textContent === 'Open hosted link')).toBe(true);
  });

  it.each([404, 410])('a removed or expired report (%s) says so honestly', async (status) => {
    pageFetch.mockResolvedValueOnce({ status, ok: false, text: async () => '' });
    const el = await mount({ email: 'o@x.com', savedReport: { id: REPORT_ID, title: 'T' } });
    expect(el.querySelector('[data-testid="chat-report-gone"]')?.textContent).toMatch(/no longer available/);
    expect(el.querySelector('[data-testid="chat-report-frame"]')).toBeNull();
    expect(pdfLink(el)).toBeNull();
  });

  it('a server or network failure offers Try again, which re-reads the report', async () => {
    pageFetch.mockResolvedValueOnce({ status: 503, ok: false, text: async () => '' });
    const el = await mount({ email: 'o@x.com', savedReport: { id: REPORT_ID, title: 'T' } });
    const retry = el.querySelector('[data-testid="chat-report-error"] button') as HTMLButtonElement;
    expect(retry.textContent).toBe('Try again');
    pageFetch.mockResolvedValueOnce({ status: 200, ok: true, text: async () => HOSTED });
    await act(async () => { retry.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(pageFetch).toHaveBeenCalledTimes(2);
    expect((el.querySelector('[data-testid="chat-report-frame"]') as HTMLIFrameElement).getAttribute('srcdoc')).toContain('HOSTED REPORT BODY');
  });

  it('a malformed saved id makes no request and shows "no longer available"', async () => {
    const el = await mount({ email: 'o@x.com', savedReport: { id: '../admin', title: 'T' } });
    expect(pageFetch).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="chat-report-gone"]')).not.toBeNull();
  });
});
