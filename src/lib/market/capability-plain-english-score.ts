/**
 * Scores one capability_market_match result against a plain-English fixture case.
 * Shared by the hermetic unit test and the live oracle (scripts/verify-capability-match.ts)
 * so both apply the SAME bar.
 */
import type { CapabilityPlainEnglishCase } from './__fixtures__/capability-plain-english-cases';

export interface ScoredCase {
  id: string;
  pass: boolean;
  tier: 'grounded' | 'candidate' | 'empty' | 'degraded';
  anchor: string | null;
  naics: string[];
  reasons: string[];
}

interface ResultLike {
  market: { lead_keyword?: string | null; top_naics?: { code: string }[]; candidate_naics?: { code: string }[] | null } | null;
  _meta: { grounded?: boolean; degraded?: boolean; selected_anchor?: string | null };
}

export function resultTier(r: ResultLike): ScoredCase['tier'] {
  if (r._meta.degraded) return 'degraded';
  if (r._meta.grounded) return 'grounded';
  const codes = r.market?.top_naics?.length ? r.market.top_naics : r.market?.candidate_naics ?? [];
  return r.market && codes.length > 0 ? 'candidate' : 'empty';
}

export function scoreCase(c: CapabilityPlainEnglishCase, r: ResultLike): ScoredCase {
  const tier = resultTier(r);
  const anchor = (r.market?.lead_keyword ?? r._meta.selected_anchor ?? null)?.toLowerCase() ?? null;
  const codes = (r.market?.top_naics?.length ? r.market.top_naics : r.market?.candidate_naics ?? []).map((n) => n.code);
  const reasons: string[] = [];

  if (tier === 'degraded') reasons.push('degraded (timeout / upstream failure) — not a quality result');
  if (c.tier === 'empty') {
    if (tier !== 'empty') reasons.push(`expected an honest empty, got ${tier} on "${anchor}"`);
  } else {
    if (tier === 'empty' && c.tier === 'candidate') reasons.push('no market returned');
    if (tier === 'candidate' || tier === 'grounded') {
      if (!anchor || !c.acceptAnchor.some((w) => anchor.includes(w))) reasons.push(`anchor "${anchor}" is not the activity (${c.acceptAnchor.join('|')})`);
      if (!codes.slice(0, 3).some((code) => c.acceptNaics.some((p) => code.startsWith(p)))) reasons.push(`top NAICS ${codes.slice(0, 3).join(',') || '—'} outside ${c.acceptNaics.join('|')}`);
      for (const f of c.forbidAnchor ?? []) {
        if (anchor && new RegExp(`\\b${f}\\b`).test(anchor)) reasons.push(`anchor uses descriptor "${f}"`);
      }
    }
  }
  return { id: c.id, pass: reasons.length === 0, tier, anchor, naics: codes.slice(0, 3), reasons };
}
