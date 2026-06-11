import { getRotatedSAMKey } from '@/lib/sam/utils';
import { filenameFromDisposition } from '@/lib/sam/sow-detect';

export interface SamAttachmentRef {
  url: string;
  name?: string;
  fileId?: string | null;
}

/** Extract SAM file UUID from a resource download URL. */
export function extractSamFileId(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && last.toLowerCase() !== 'download') return last;
    if (parts.length >= 2) return parts[parts.length - 2] || null;
  } catch {
    /* ignore */
  }
  return null;
}

/** Normalize a DB attachment entry (string URL or { url, name } object). */
export function parseSamAttachment(entry: unknown): SamAttachmentRef | null {
  if (!entry) return null;
  if (typeof entry === 'object' && (entry as Record<string, unknown>)._no_attachments) {
    return null;
  }

  if (typeof entry === 'string') {
    const url = entry.trim();
    if (!url.startsWith('http')) return null;
    return { url, fileId: extractSamFileId(url) };
  }

  if (typeof entry === 'object') {
    const obj = entry as Record<string, unknown>;
    const url = (obj.url || obj.link || obj.resourceLink) as string | undefined;
    if (!url || !url.startsWith('http')) return null;
    const rawName = (obj.name || obj.fileName || obj.title) as string | undefined;
    const name = rawName && rawName.toLowerCase() !== 'download' ? rawName.trim() : undefined;
    return {
      url,
      name,
      fileId: (typeof obj.fileId === 'string' ? obj.fileId : null) || extractSamFileId(url),
    };
  }

  return null;
}

/** True when we should HEAD SAM for the real filename (missing or auto-numbered). */
export function attachmentNeedsFilenameResolution(ref: SamAttachmentRef): boolean {
  if (!ref.name) return true;
  return /^document\s+\d+/i.test(ref.name);
}

/**
 * Pull the real filename from SAM's file-download endpoint via Content-Disposition.
 * HEAD first; fall back to GET when SAM returns 405.
 */
export async function fetchSamAttachmentFilename(fileUrl: string, apiKey?: string): Promise<string | null> {
  const key = apiKey || getRotatedSAMKey();
  if (!key) return null;

  let target: URL;
  try {
    target = new URL(fileUrl);
    if (!/(^|\.)sam\.gov$/i.test(target.hostname)) return null;
  } catch {
    return null;
  }

  if (!target.searchParams.has('api_key')) {
    target.searchParams.set('api_key', key);
  }

  let res: Response;
  try {
    res = await fetch(target.toString(), { method: 'HEAD' });
    if (res.status === 405) {
      res = await fetch(target.toString(), { method: 'GET', headers: { Range: 'bytes=0-0' } });
    }
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const name = filenameFromDisposition(res.headers.get('content-disposition'));
  return name || null;
}

/** Human label for an attachment row — prefers resolved SAM filename. */
export function labelSamAttachment(
  ref: SamAttachmentRef,
  index: number,
  resolvedFilename?: string | null,
): string {
  const candidate = (resolvedFilename || ref.name || '').trim();
  if (candidate && !/^document\s+\d+/i.test(candidate)) {
    return candidate;
  }
  return `Attachment ${index + 1}`;
}

export function samAttachmentDownloadHref(url: string): string {
  return /(^|\.)sam\.gov\//i.test(url)
    ? `/api/sam-attachment?url=${encodeURIComponent(url)}`
    : url;
}
