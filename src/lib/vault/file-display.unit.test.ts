import { describe, it, expect } from 'vitest';
import { fileTypeLabel, formatFileSize, fileMetaLine } from './file-display';

describe('fileTypeLabel', () => {
  it('prefers mime over doc_type other', () => {
    expect(fileTypeLabel({
      original_filename: 'Brief.pdf',
      mime_type: 'application/pdf',
      doc_type: 'other',
    })).toBe('PDF');
    expect(fileTypeLabel({
      original_filename: 'Brief.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      doc_type: 'other',
    })).toBe('Word');
    expect(fileTypeLabel({
      original_filename: 'Brief.xlsx',
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      doc_type: 'other',
    })).toBe('Excel');
    expect(fileTypeLabel({
      original_filename: 'Brief.csv',
      mime_type: 'text/csv; charset=utf-8',
      doc_type: 'other',
    })).toBe('CSV');
  });

  it('falls back to extension when mime missing', () => {
    expect(fileTypeLabel({ original_filename: 'Acme.docx', doc_type: 'other' })).toBe('Word');
    expect(fileTypeLabel({ original_filename: 'rates.CSV', doc_type: 'other' })).toBe('CSV');
  });

  it('shows capability statement for cap_stmt when mime unknown', () => {
    expect(fileTypeLabel({ original_filename: 'x.bin', doc_type: 'cap_stmt' })).toBe('Capability statement');
  });
});

describe('formatFileSize', () => {
  it('never shows 0 KB for a real small file', () => {
    expect(formatFileSize(300)).toBe('300 B');
    expect(formatFileSize(475)).toBe('475 B');
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('uses KB / MB at larger sizes', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(12_288)).toBe('12 KB');
    expect(formatFileSize(1_500_000)).toBe('1.4 MB');
  });

  it('empty for missing', () => {
    expect(formatFileSize(null)).toBe('');
    expect(formatFileSize(undefined)).toBe('');
  });
});

describe('fileMetaLine', () => {
  it('assembles type + size for a generated csv', () => {
    const m = fileMetaLine({
      original_filename: 'Strategy.csv',
      mime_type: 'text/csv',
      doc_type: 'other',
      size_bytes: 475,
      parse_status: 'parsed',
    });
    expect(m.type).toBe('CSV');
    expect(m.size).toBe('475 B');
    expect(m.parse).toBe('parsed');
  });
});
