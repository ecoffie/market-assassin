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
  it('names common formats for the Export menu', () => {
    expect(labelForFormat('pdf')).toBe('PDF');
    expect(labelForFormat('docx')).toBe('Word');
    expect(labelForFormat('xlsx')).toBe('Excel');
    expect(labelForFormat('csv')).toBe('CSV');
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

  it('shows one Export toggle; formats appear only after open', async () => {
    const el = await mount([
      { format: 'pdf', document_id: 'p1', file_name: 'Strategy.pdf' },
      { format: 'docx', document_id: 'd1', file_name: 'Strategy.docx' },
    ]);
    expect(el.querySelector('[data-testid="export-toggle"]')?.textContent).toMatch(/Export/);
    expect(el.querySelector('[data-testid="download-pdf"]')).toBeNull();
    await act(async () => {
      (el.querySelector('[data-testid="export-toggle"]') as HTMLButtonElement).click();
    });
    expect(el.querySelector('[data-testid="download-pdf"]')?.textContent).toBe('PDF');
    expect(el.querySelector('[data-testid="download-docx"]')?.textContent).toBe('Word');
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
      (el.querySelector('[data-testid="export-toggle"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (el.querySelector('[data-testid="download-pdf"]') as HTMLButtonElement).click();
    });
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0][0])).toContain('id=p1');
    expect(assign).toHaveBeenCalledWith('https://signed.example/file.pdf');
  });
});
