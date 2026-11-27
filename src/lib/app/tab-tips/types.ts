import type { AppPanel } from '@/components/app/UnifiedSidebar';

/**
 * "How to use this tab" content for ONE app panel (owner request, 2026-11-27).
 *
 * Rules every entry must follow (enforced by tab-tips.unit.test.ts):
 *  - TRUE for the current code of that panel: only name buttons, filters and features that exist there.
 *  - Plain words for beginners; explain NAICS / PSC / recompete / forecast in a few words when used.
 *  - 2-3 short steps + exactly one tip. No prices, plans, credit amounts, superlatives or customer data.
 */
/**
 * One step. A plain string is a hint with no highlight. The object form can name the exact element the
 * step talks about: `anchor` is a CSS selector looked up in the page (first match wins). Prefer
 * `[data-tip="<panel>-<thing>"]`, then a stable `#id` or `[aria-label="..."]`. A missing anchor (not on
 * the page yet, hidden, invalid selector, or an iframe tab) shows the hint without a highlight.
 */
export type TabTipStep = string | { text: string; anchor?: string };

/** A step after normalisation (what the coach renders). */
export interface TabTipStepNormalized {
  text: string;
  anchor?: string;
}

export interface TabTips {
  /** Optional heading override. Default: "How to use this tab". */
  title?: string;
  /** 2-3 short, numbered steps. */
  steps: TabTipStep[];
  /** One helpful tip, shown after "Tip:". */
  tip: string;
}

/** Panel id (an AppPanel) → its tips. A panel without an entry shows no box. */
export type TabTipsRegistry = Partial<Record<AppPanel, TabTips>>;
