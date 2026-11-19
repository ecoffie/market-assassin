/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { GeneratedDownloadChips, labelForFormat } from './GeneratedDownloadChips';

const fetchMock = vi.fn();
vi.mock('@/components/app/authHeaders', () => ({
  authedFetch: (...args: unknown[]) => fetchMock(...args),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('labelForFormat', () => {
  it('names common formats for customers', () => {
    expect(labelForFormat('pdf')).toBe('Download PDF');
    expect(labelForFormat('docx')).toBe('Download Word');
    expect(labelForFormat('xlsx')).toBe('Download Excel');
    expect(labelForFormat('csv')).toBe('Download CSV');
  });
});

describe('GeneratedDownloadChips', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    document.body.innerHTML = '';
  });
  afterEach(() => { document.body.innerHTML = ''; });

  async function mount(files: Array<{ format: string; document_id: string; file_name?: string }>, pdfNote?: string) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(<GeneratedDownloadChips email="pro@example.com" files={files} pdfNote={pdfNote} />);
    });
    return el;
  }

  it('renders PDF and Word chips', async () => {
    const el = await mount([
      { format: 'pdf', document_id: 'p1', file_name: 'Strategy.pdf' },
      { format: 'docx', document_id: 'd1', file_name: 'Strategy.docx' },
    ]);
    expect(el.querySelector('[data-testid="download-pdf"]')?.textContent).toMatch(/Download PDF/);
    expect(el.querySelector('[data-testid="download-docx"]')?.textContent).toMatch(/Download Word/);
  });

  it('shows pdf_note when PDF missing', async () => {
    const el = await mount(
      [{ format: 'docx', document_id: 'd1' }],
      'The PDF could not be produced right now; the Word file was saved.',
    );
    expect(el.textContent).toMatch(/PDF could not be produced/);
  });

  it('mints a signed URL then navigates', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ url: 'https://signed.example/file.pdf' }) });
    const el = await mount([{ format: 'pdf', document_id: 'p1' }]);
    await act(async () => {
      (el.querySelector('[data-testid="download-pdf"]') as HTMLButtonElement).click();
    });
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0][0])).toContain('id=p1');
    expect(assign).toHaveBeenCalledWith('https://signed.example/file.pdf');
  });
});
