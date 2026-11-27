/**
 * Per-tab "How to use this tab" box (owner request, 2026-11-27). Ships OFF.
 *
 * Switch: NEXT_PUBLIC_TAB_TIPS === 'on'. Anything else (unset included) = OFF, and the app renders
 * exactly as before. Content lives in the content-*.ts group files listed in TAB_TIPS_SOURCES; each
 * exports `TAB_TIPS: TabTipsRegistry`. Writers add entries to those files and never edit this one.
 */
import type { TabTips, TabTipsRegistry } from './types';
import { TAB_TIPS as example } from './content-example';
import { TAB_TIPS as research } from './content-research';
import { TAB_TIPS as people } from './content-people';
import { TAB_TIPS as work } from './content-work';
import { TAB_TIPS as more } from './content-more';

export type { TabTips, TabTipsRegistry } from './types';

/** Every content group, in merge order. A panel id may appear in only ONE group (test-enforced). */
export const TAB_TIPS_SOURCES: ReadonlyArray<{ file: string; tips: TabTipsRegistry }> = [
  { file: 'content-example.ts', tips: example },
  { file: 'content-research.ts', tips: research },
  { file: 'content-people.ts', tips: people },
  { file: 'content-work.ts', tips: work },
  { file: 'content-more.ts', tips: more },
];

export const TAB_TIPS: TabTipsRegistry = Object.assign({}, ...TAB_TIPS_SOURCES.map(s => s.tips));

/** The code-level switch. Default OFF. `process.env.NEXT_PUBLIC_*` must be referenced literally to inline. */
export function isTabTipsEnabled(value: string | undefined = process.env.NEXT_PUBLIC_TAB_TIPS): boolean {
  return value === 'on';
}

/** The tips for a panel, or null when it has none (no entry = no box). */
export function getTabTips(panelId: string | null | undefined): TabTips | null {
  if (!panelId) return null;
  if (!Object.prototype.hasOwnProperty.call(TAB_TIPS, panelId)) return null;
  return (TAB_TIPS as Record<string, TabTips | undefined>)[panelId] ?? null;
}

export const TAB_TIPS_DEFAULT_TITLE = 'How to use this tab';

/** localStorage key that remembers "hidden" for one tab. */
export function tabTipsStorageKey(panelId: string): string {
  return `mindy_tab_tips_hidden:${panelId}`;
}
