import { getNaics, getNaicsByPrefix, getPsc } from '@/lib/codes/lookup';

/** Census 2022 table in `naics-codes.json` via getNaics / getNaicsByPrefix. */
export function isKnownNaicsCode(code: string): boolean {
  const clean = String(code || '').trim();
  if (!/^\d{2,6}$/.test(clean)) return false;
  if (getNaics(clean)) return true;
  return clean.length < 6 && getNaicsByPrefix(clean).length > 0;
}

/** Spend-derived title table (~700). Display only. Not the write authority. */
export function isKnownPscCode(code: string): boolean {
  return getPsc(code) != null;
}

/**
 * GSA PSC / FSC shape. Four alphanumeric characters.
 * Numeric codes are FSC product classes (6520, 8405, 8905).
 * Letter-leading codes are services / R&D (R425, AQ93).
 * Do not require a hit in the smaller spend-derived table.
 */
export function isAcceptablePscCode(code: string): boolean {
  return /^[A-Z0-9]{4}$/.test(String(code || '').trim().toUpperCase());
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
    .filter((c) => !isAcceptablePscCode(c));
}

/** Codes the matcher may expand or query. Legacy invalids stay on the row. */
export function knownNaicsForMatch(codes: string[] | null | undefined): string[] {
  return (codes || [])
    .map((c) => String(c).trim())
    .filter((c) => isKnownNaicsCode(c));
}

/** Unknown NAICS in `incoming` that are not already stored. Those are new adds. */
export function unknownNaicsBeingAdded(
  incoming: string[] | null | undefined,
  existing: string[] | null | undefined,
): string[] {
  const have = new Set((existing || []).map((c) => String(c).trim()).filter(Boolean));
  return (incoming || [])
    .map((c) => String(c).trim())
    .filter(Boolean)
    .filter((c) => !isKnownNaicsCode(c) && !have.has(c));
}

/** Client commit. Keep stored invalids. Drop newly typed unknowns. */
export function commitNaicsFromTypedInput(
  typed: string[] | null | undefined,
  stored: string[] | null | undefined,
): { persist: string[]; blockedAdds: string[] } {
  const incoming = (typed || []).map((c) => String(c).trim()).filter(Boolean);
  const have = new Set((stored || []).map((c) => String(c).trim()).filter(Boolean));
  return {
    persist: incoming.filter((c) => isKnownNaicsCode(c) || have.has(c)),
    blockedAdds: unknownNaicsBeingAdded(incoming, stored),
  };
}

/** Server write. New unknown codes 400. Already-stored invalids may remain. */
export function persistNaicsWrite(
  incoming: string[] | null | undefined,
  existing: string[] | null | undefined,
): { ok: true; codes: string[] } | { ok: false; error: string; blocked: string[] } {
  const codes = (incoming || []).map((c) => String(c).trim()).filter(Boolean);
  const blocked = unknownNaicsBeingAdded(codes, existing);
  if (blocked.length > 0) {
    return {
      ok: false,
      blocked,
      error: `Invalid NAICS code "${blocked[0]}". Use a Census 2022 code.`,
    };
  }
  return { ok: true, codes };
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
      return { ok: false, error: 'pscCodes must be an array of PSC or FSC codes.' };
    }
    for (const raw of psc) {
      const code = String(raw).trim();
      if (!code) continue;
      if (!isAcceptablePscCode(code)) {
        return { ok: false, error: `Invalid PSC/FSC code "${code}". Use a 4-character code.` };
      }
    }
  }
  return { ok: true };
}
