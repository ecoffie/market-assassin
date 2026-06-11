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

/** Auto-numbered placeholders from backfill when SAM filename lookup failed. */
export function isGenericAttachmentName(name: string | undefined | null): boolean {
  if (!name) return true;
  const t = name.trim();
  if (!t || t.toLowerCase() === 'download') return true;
  return /^(document|attachment)\s+\d+(\.\w+)?$/i.test(t);
}

/** True when we should fetch SAM for the real filename (missing or auto-numbered). */
export function attachmentNeedsFilenameResolution(ref: SamAttachmentRef): boolean {
  return isGenericAttachmentName(ref.name);
}

/**
 * Pull the real filename from SAM's file-download endpoint via Content-Disposition.
 * SAM returns 403 on HEAD — use a ranged GET first (206 + disposition header).
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

  const targetUrl = target.toString();
  const attempts: RequestInit[] = [
    { method: 'GET', headers: { Range: 'bytes=0-0' } },
    { method: 'HEAD' },
  ];

  for (const init of attempts) {
    try {
      const res = await fetch(targetUrl, init);
      if (!res.ok) continue;
      const name = filenameFromDisposition(res.headers.get('content-disposition'));
      if (name) return name;
    } catch {
      /* try next */
    }
  }

  return null;
}

/** Human label for an attachment row — prefers resolved SAM filename. */
export function labelSamAttachment(
  ref: SamAttachmentRef,
  index: number,
  resolvedFilename?: string | null,
): string {
  const candidate = (resolvedFilename || ref.name || '').trim();
  if (candidate && !isGenericAttachmentName(candidate)) {
    return candidate;
  }
  return `Attachment ${index + 1}`;
}

export function samAttachmentDownloadHref(url: string): string {
  return /(^|\.)sam\.gov\//i.test(url)
    ? `/api/sam-attachment?url=${encodeURIComponent(url)}`
    : url;
}
