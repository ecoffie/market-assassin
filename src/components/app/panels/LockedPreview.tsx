'use client';

/**
 * LockedPreview — the reusable "data behind glass" shell for free-tier surfaces.
 *
 * Enterprise-SaaS pattern (HubSpot/Salesforce/Notion "data behind glass",
 * Apollo/ZoomInfo "count + blurred rows"): a free user clicking a Pro feature
 * should NEVER hit a blank wall in front of their own data or a valuable catalog.
 * They should SEE it — read-only or blurred — with one clear upgrade action.
 *
 * Two modes (pick per surface):
 *   - Treatment A ("their data"):   pass `children` = a read-only render of the
 *     user's OWN records (e.g. tracked pursuits). Header CTA = "Upgrade to manage".
 *   - Treatment B ("catalog"):      pass `count` + `sampleRows` = real match count
 *     and a few teaser rows we BLUR. Header CTA = "Upgrade to unlock".
 *
 * All data shown must be REAL (rule #1: no fabricated counts or rows). The count
 * is the real match total; blurred rows are real records with a blur overlay —
 * we obscure, we don't invent.
 *
 * The upgrade action reuses the app's shared UpgradeModal (same featureId map,
 * same checkout links) so pricing/copy stays in one place.
 */

import { useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { UpgradeModal } from '../UpgradeModal';

export interface LockedPreviewProps {
  /** UpgradeModal feature key (drives the pitch copy + checkout links). */
  featureId: string;
  /** Panel title, e.g. "My Pursuits" or "Expiring Contracts". */
  title: string;
  /** One-line description under the title. */
  subtitle?: string;
  /** CTA label. Defaults to "Upgrade to Pro". */
  ctaLabel?: string;
  /**
   * Treatment A: a read-only render of the user's OWN data. When provided,
   * it renders above the upgrade bar (no blur — it's their data, just not
   * editable on free).
   */
  children?: ReactNode;
  /**
   * Treatment B: real match count for the "N results match you" line. Omit
   * for Treatment A.
   */
  count?: number | null;
  /** Treatment B: the noun for the count line, e.g. "expiring contracts". */
  countNoun?: string;
  /**
   * Treatment B: a few REAL teaser rows we render blurred. Each is just a
   * short label (title/agency); we blur them, we do not fabricate them.
   */
  sampleRows?: string[];
  /** Loading spinner state while the count/rows fetch. */
  loading?: boolean;
}

export default function LockedPreview({
  featureId,
  title,
  subtitle,
  ctaLabel = 'Upgrade to Pro',
  children,
  count,
  countNoun = 'results',
  sampleRows,
  loading,
}: LockedPreviewProps) {
  const [showUpgrade, setShowUpgrade] = useState(false);
  const hasCatalog = typeof count === 'number' || (sampleRows && sampleRows.length > 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {/* Header + primary CTA */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-white">{title}</h1>
            <span className="inline-flex items-center gap-1 rounded-full border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-[11px] font-medium text-purple-300">
              <Lock className="h-3 w-3 shrink-0" strokeWidth={2} /> Pro
            </span>
          </div>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={() => setShowUpgrade(true)}
          className="shrink-0 rounded-lg bg-gradient-to-r from-purple-600 to-purple-500 px-4 py-2 text-sm font-semibold text-white shadow hover:from-purple-500 hover:to-purple-400"
        >
          {ctaLabel} →
        </button>
      </div>

      {/* Treatment B — real count + blurred teaser rows (catalog surfaces). */}
      {hasCatalog && (
        <div className="mt-5 rounded-xl border border-surface bg-ground/60 p-4">
          {loading ? (
            <div className="text-sm text-faint">Counting matches…</div>
          ) : (
            <>
              {typeof count === 'number' && (
                <p className="text-sm text-slate-200">
                  <span className="text-2xl font-bold text-emerald-300">{count.toLocaleString()}</span>{' '}
                  {countNoun} match your profile.
                </p>
              )}
              {sampleRows && sampleRows.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {sampleRows.slice(0, 5).map((row, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-2 rounded-lg border border-surface bg-ground-deep/50 px-3 py-2"
                    >
                      {/* Real row, blurred — obscured, not invented. */}
                      <span className="min-w-0 flex-1 truncate text-sm text-ink-soft select-none blur-sm" aria-hidden>
                        {row}
                      </span>
                      <Lock className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={2} />
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => setShowUpgrade(true)}
                className="mt-3 text-sm font-medium text-purple-400 hover:text-purple-300"
              >
                Unlock all {typeof count === 'number' ? count.toLocaleString() : ''} {countNoun} in Pro →
              </button>
            </>
          )}
        </div>
      )}

      {/* Treatment A — the user's OWN data, read-only (no blur). */}
      {children && <div className="mt-5">{children}</div>}

      {/* Upgrade nudge footer bar (always present as the durable CTA). */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-purple-500/25 bg-gradient-to-br from-purple-950/40 to-slate-950/60 px-4 py-3">
        <p className="text-sm text-purple-100">
          {children
            ? 'This is a read-only preview. Upgrade to Pro to manage stages, drafts, contacts, and documents.'
            : 'Upgrade to Pro to see the full list and act on every match.'}
        </p>
        <button
          type="button"
          onClick={() => setShowUpgrade(true)}
          className="shrink-0 rounded-lg bg-purple-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-purple-500"
        >
          {ctaLabel} →
        </button>
      </div>

      {showUpgrade && <UpgradeModal featureId={featureId} onClose={() => setShowUpgrade(false)} />}
    </div>
  );
}
