/**
 * Past performance with NOTHING on file.
 *
 * Measured 2026-11-23 (MCP draft_proposal_section, past_performance, vault
 * past_performance = 0): the model ignored the "NO VAULT PAST PERFORMANCE"
 * prompt rule and wrote "Our past work with the VA has equipped us…" plus three
 * described contracts. The fact guard only neutralizes numbers / emails /
 * phones, so invented prose credentials reached the user. A fabricated past
 * performance claim in a federal proposal is a False-Claims-Act-class risk.
 *
 * So the rule is enforced in code, not in the prompt: a past-performance
 * section with no vault past performance is NEVER sent to the model. The user
 * gets a fill-in template (every fact bracketed) plus plain guidance on what
 * they can legitimately use. Nothing here asserts anything about the bidder.
 */
import type { SectionType, VaultContext } from './types';

export type PastPerformanceGap = 'none_on_file' | 'unavailable';

export function isPastPerformanceSection(s: SectionType): boolean {
  return s === 'past_performance' || s === 'cap_past_performance';
}

/**
 * null = past performance exists, draft normally.
 * 'unavailable' = the vault query failed (unknown is never zero — do not
 * treat it as "no past performance").
 */
export function pastPerformanceGap(sectionType: SectionType, vault: VaultContext): PastPerformanceGap | null {
  if (!isPastPerformanceSection(sectionType)) return null;
  if (vault.unavailable?.includes('past_performance')) return 'unavailable';
  return (vault.past_performance?.length ?? 0) > 0 ? null : 'none_on_file';
}

const REFERENCE_SLOT = (n: number) =>
  `${n}. **[Project title]**\n` +
  `   - Customer: [federal agency, state or local government, commercial client, or the prime you subcontracted to]\n` +
  `   - Your role: [prime / subcontractor / key personnel]\n` +
  `   - Value: [contract value]  ·  Period: [start date] to [end date]\n` +
  `   - What you did: [scope that matches this requirement]\n` +
  `   - Result: [an outcome you can document]\n` +
  `   - Reference: [name, title, phone, email]`;

const GUIDANCE =
  `### What you can use as past performance\n` +
  `- Relevant commercial, state and local, and subcontract work, not only federal prime contracts. Show how its scope matches this requirement.\n` +
  `- The evaluation should consider past performance of predecessor companies, key personnel with relevant experience, and subcontractors doing major parts of the work (FAR 15.305(a)(2)(iii)).\n` +
  `- With no relevant record, an offeror may not be evaluated favorably or unfavorably on past performance (FAR 15.305(a)(2)(iv)). This applies to FAR Part 15 source selections; check this solicitation's evaluation section.\n` +
  `- The solicitation's instructions decide how many references, how recent, and how relevant. Follow them over this template.\n` +
  `- Never describe work you did not do. Add your real projects to your Mindy vault and this section will be drafted from them.`;

export function noPastPerformanceDraft(sectionType: SectionType, label: string, gap: PastPerformanceGap): string {
  const notice =
    gap === 'unavailable'
      ? `> Your saved past performance could not be loaded just now. Nothing was drafted, so no claim was made about your company. Retry before submitting.`
      : `> No past performance is saved in your Mindy vault, so nothing was written for you. Every bracket below is a fact only you can supply.`;
  const slots = sectionType === 'cap_past_performance' ? [1, 2] : [1, 2, 3];
  return [
    `## ${label}`,
    notice,
    `### Relevant projects`,
    slots.map(REFERENCE_SLOT).join('\n\n'),
    gap === 'none_on_file' ? GUIDANCE : '',
  ].filter(Boolean).join('\n\n');
}
