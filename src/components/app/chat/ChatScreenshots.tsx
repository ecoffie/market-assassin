'use client';
/**
 * Screenshot chips above the Ask Mindy composer: a thumbnail per pasted/dropped image with a remove button,
 * plus a plain-English note when one was refused. Holds nothing itself — the panel owns the list and sends it
 * with exactly one turn.
 */
import { X } from 'lucide-react';
import type { PreparedScreenshot } from '@/lib/chat/screenshot-client';

export function ChatScreenshots({ shots, note, onRemove, disabled }: {
  shots: PreparedScreenshot[];
  note: string | null;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  if (!shots.length && !note) return null;
  return (
    <div className="mb-2" data-testid="chat-screenshots">
      {shots.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Attached screenshots">
          {shots.map((s, i) => (
            <li key={s.id} className="relative h-14 w-20 overflow-hidden rounded-md border border-hairline bg-ground">
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview, never a remote url */}
              <img src={s.previewUrl} alt={`Screenshot ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onRemove(s.id)}
                disabled={disabled}
                aria-label={`Remove screenshot ${i + 1}`}
                data-testid="chat-screenshot-remove"
                className="absolute right-0.5 top-0.5 rounded bg-black/70 p-0.5 text-white hover:bg-black disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {note && <p role="status" className="mt-1 text-[11px] text-amber-300" data-testid="chat-screenshot-note">{note}</p>}
    </div>
  );
}
