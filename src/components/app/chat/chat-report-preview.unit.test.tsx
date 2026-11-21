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

  it('a packaged market report renders its inline HTML with no fetch', async () => {
    const el = await mount({ email: 'o@x.com', inline: { html: RICH_HTML, title: 'Acme market report', url: 'https://getmindy.ai/reports/abc' } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((el.querySelector('[data-testid="chat-report-frame"]') as HTMLIFrameElement).getAttribute('srcdoc')).toContain('The read');
    expect(el.querySelector('a[href="https://getmindy.ai/reports/abc"]')).toBeTruthy();
  });
});
