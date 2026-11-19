/**
 * Human labels for Vault document rows — file KIND (PDF/Word/…) and readable sizes.
 * `doc_type` is a category tag (often "other" for generated files); never show it as the type.
 */

export type FileDisplayDoc = {
  original_filename?: string | null;
  mime_type?: string | null;
  doc_type?: string | null;
  size_bytes?: number | null;
};

const MIME_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.ms-excel': 'Excel',
  'text/csv': 'CSV',
  'text/plain': 'Text',
};

const EXT_LABEL: Record<string, string> = {
  pdf: 'PDF',
  docx: 'Word',
  doc: 'Word',
  xlsx: 'Excel',
  xls: 'Excel',
  csv: 'CSV',
  txt: 'Text',
};

/** Category tags that are useful to show (not a file format). */
const DOC_TYPE_LABEL: Record<string, string> = {
  cap_stmt: 'Capability statement',
  proposal_section: 'Proposal section',
  briefing: 'Briefing',
};

function extOf(name: string | null | undefined): string {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m?.[1] || '';
}

/** Prefer mime → extension → known doc_type label → empty (caller may omit). */
export function fileTypeLabel(d: FileDisplayDoc): string {
  const mime = String(d.mime_type || '').split(';')[0].trim().toLowerCase();
  if (mime && MIME_LABEL[mime]) return MIME_LABEL[mime];
  const ext = extOf(d.original_filename);
  if (ext && EXT_LABEL[ext]) return EXT_LABEL[ext];
  const dt = String(d.doc_type || '').trim().toLowerCase();
  if (dt && DOC_TYPE_LABEL[dt]) return DOC_TYPE_LABEL[dt];
  if (dt && dt !== 'other') return dt.replace(/_/g, ' ');
  return 'File';
}

/** Bytes under 1 KB stay as "N B"; never round a real file down to "0 KB". */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '';
  const n = Math.floor(bytes);
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/** One muted meta line: "PDF · 475 B · parsed" (skips empty parts). */
export function fileMetaLine(
  d: FileDisplayDoc & { page_count?: number | null; version?: number | null; parse_status?: string | null },
  opts?: { showVersion?: boolean },
): { type: string; size: string; pages: string; version: string; parse: string } {
  return {
    type: fileTypeLabel(d),
    size: formatFileSize(d.size_bytes),
    pages: d.page_count && d.page_count > 0 ? `${d.page_count} page${d.page_count === 1 ? '' : 's'}` : '',
    version: opts?.showVersion && d.version && d.version > 1 ? `v${d.version}` : '',
    parse: String(d.parse_status || ''),
  };
}
