import { getNaics, getNaicsByPrefix, getPsc } from '@/lib/codes/lookup';

/** Census 2022 table in `naics-codes.json` via getNaics / getNaicsByPrefix. */
export function isKnownNaicsCode(code: string): boolean {
  const clean = String(code || '').trim();
  if (!/^\d{2,6}$/.test(clean)) return false;
  if (getNaics(clean)) return true;
  return clean.length < 6 && getNaicsByPrefix(clean).length > 0;
}

export function isKnownPscCode(code: string): boolean {
  return getPsc(code) != null;
}

export function invalidNaicsCodes(codes: string[] | null | undefined): string[] {
  return (codes || [])
    .map((c) => String(c).trim())
    .filter(Boolean)
    .filter((c) => !isKnownNaicsCode(c));
}

export function invalidPscCodes(codes: string[] | null | undefined): string[] {
  return (codes || [])
    .map((c) => String(c).trim())
    .filter(Boolean)
    .filter((c) => !isKnownPscCode(c));
}

export function validateMarketCodesInput(
  naics?: unknown,
  psc?: unknown,
): { ok: true } | { ok: false; error: string } {
  if (naics !== undefined) {
    if (!Array.isArray(naics)) {
      return { ok: false, error: 'naicsCodes must be an array of Census codes.' };
    }
    for (const raw of naics) {
      const code = String(raw).trim();
      if (!code) continue;
      if (!isKnownNaicsCode(code)) {
        return { ok: false, error: `Invalid NAICS code "${code}". Use a Census 2022 code.` };
      }
    }
  }
  if (psc !== undefined) {
    if (!Array.isArray(psc)) {
      return { ok: false, error: 'pscCodes must be an array of known PSC codes.' };
    }
    for (const raw of psc) {
      const code = String(raw).trim();
      if (!code) continue;
      if (!isKnownPscCode(code)) {
        return { ok: false, error: `Invalid PSC code "${code}". Use a known PSC.` };
      }
    }
  }
  return { ok: true };
}
