import { invalidNaicsCodes } from '@/lib/codes/validate-market-codes';

/**
 * A saved search's stored NAICS codes and which are not Census 2022 (validate-market-codes: 6-digit codes
 * must exist; 2–5 digit prefixes must prefix a real code). Reported only — never rewritten or dropped:
 * dropping a search's only code would WIDEN it to every opportunity.
 */
export function storedNaicsValidity(filters: unknown): { stored: string[]; invalid: string[] } {
  const raw = (filters as Record<string, unknown> | null)?.naics;
  const stored = (Array.isArray(raw) ? raw : String(raw ?? '').split(','))
    .map((c) => String(c).trim()).filter(Boolean);
  return { stored, invalid: invalidNaicsCodes(stored) };
}
