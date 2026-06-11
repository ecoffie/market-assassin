'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  attachmentNeedsFilenameResolution,
  labelSamAttachment,
  parseSamAttachment,
  samAttachmentDownloadHref,
  type SamAttachmentRef,
} from '@/lib/sam/attachment-metadata';

interface SamAttachmentLinksProps {
  attachments: unknown[];
  onDownloadClick?: (index: number, ref: SamAttachmentRef) => void;
  className?: string;
}

export default function SamAttachmentLinks({
  attachments,
  onDownloadClick,
  className = '',
}: SamAttachmentLinksProps) {
  const parsed = useMemo(
    () => attachments.map(parseSamAttachment).filter((ref): ref is SamAttachmentRef => ref !== null),
    [attachments],
  );

  const [resolvedNames, setResolvedNames] = useState<Record<number, string>>({});

  useEffect(() => {
    setResolvedNames({});
    if (parsed.length === 0) return;

    let cancelled = false;
    const pending = parsed
      .map((ref, index) => ({ ref, index }))
      .filter(({ ref }) => attachmentNeedsFilenameResolution(ref));

    if (pending.length === 0) return;

    void (async () => {
      const results = await Promise.all(
        pending.map(async ({ ref, index }) => {
          try {
            const res = await fetch(`/api/sam-attachment/metadata?url=${encodeURIComponent(ref.url)}`);
            if (!res.ok) return { index, filename: null as string | null };
            const data = (await res.json()) as { filename?: string };
            return { index, filename: data.filename?.trim() || null };
          } catch {
            return { index, filename: null };
          }
        }),
      );

      if (cancelled) return;
      setResolvedNames((prev) => {
        const next = { ...prev };
        for (const { index, filename } of results) {
          if (filename) next[index] = filename;
        }
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [parsed]);

  if (parsed.length === 0) return null;

  return (
    <div className={className}>
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">
        Attachments ({parsed.length})
      </div>
      <ul className="space-y-1.5">
        {parsed.map((ref, idx) => (
          <li key={`${ref.url}-${idx}`}>
            <a
              href={samAttachmentDownloadHref(ref.url)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onDownloadClick?.(idx, ref)}
              className="inline-flex items-center gap-2 text-sm text-purple-300 hover:text-purple-200 underline"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                />
              </svg>
              <span className="truncate">
                {labelSamAttachment(ref, idx, resolvedNames[idx])}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
