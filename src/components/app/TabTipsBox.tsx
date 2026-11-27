'use client';

/**
 * "How to use this tab" — a small box at the top of a panel (owner request, 2026-11-27).
 * Mounted ONCE, centrally, by PanelContainer (src/components/app/panels/index.tsx) — never inside a panel.
 * Hide is remembered per tab in localStorage (every access wrapped: private windows / blocked storage
 * just fall back to "shown"). A small "?" button brings the box back.
 */
import { useEffect, useId, useState } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { TAB_TIPS_DEFAULT_TITLE, tabTipsStorageKey, type TabTips } from '@/lib/app/tab-tips';

function readHidden(panelId: string): boolean {
  try {
    return window.localStorage.getItem(tabTipsStorageKey(panelId)) === '1';
  } catch {
    return false;
  }
}

function writeHidden(panelId: string, hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(tabTipsStorageKey(panelId), '1');
    else window.localStorage.removeItem(tabTipsStorageKey(panelId));
  } catch {
    /* storage unavailable — the choice lasts for this view only */
  }
}

export default function TabTipsBox({ panelId, tips }: { panelId: string; tips: TabTips }) {
  const title = tips.title || TAB_TIPS_DEFAULT_TITLE;
  const bodyId = useId();
  // Shown on first render (server and client agree); the remembered choice is applied after mount.
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(readHidden(panelId));
  }, [panelId]);

  const hide = () => { setHidden(true); writeHidden(panelId, true); };
  const show = () => { setHidden(false); writeHidden(panelId, false); };

  if (hidden) {
    return (
      <div className="flex justify-end px-4 pt-3 sm:px-6" data-testid="tab-tips-collapsed">
        <button
          type="button"
          onClick={show}
          aria-expanded={false}
          aria-label={title}
          title={title}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-hairline bg-surface text-muted hover:text-white transition-colors"
        >
          <HelpCircle className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 sm:px-6" data-testid="tab-tips-box">
      <section
        id={bodyId}
        aria-label={title}
        className="rounded-xl border border-surface bg-ground p-4 text-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-semibold text-white">{title}</h2>
          <button
            type="button"
            onClick={hide}
            aria-expanded={true}
            aria-controls={bodyId}
            aria-label={`Hide ${title.toLowerCase()}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface hover:text-white transition-colors"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Hide
          </button>
        </div>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-soft break-words">
          {tips.steps.map((step, i) => <li key={i}>{step}</li>)}
        </ol>
        <p className="mt-2 text-muted break-words">
          <strong className="text-white">Tip:</strong> {tips.tip}
        </p>
      </section>
    </div>
  );
}
