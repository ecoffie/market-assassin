/**
 * Decorate map pins with their buying office's EARLY-SIGNAL band.
 *
 * The insight this exposes: a department-level average is useless because it is
 * made of opposites. Across 470 scored offices, 115 post ZERO early notices
 * while 46 are >=50% early (NAVAL AIR SYSTEMS COMMAND 89%, DLA AVIATION 10%).
 *
 * The behavioural read is the product:
 *   high   → the requirement can still be shaped, go build the relationship
 *   none   → nothing to influence, just bid it when it posts
 *
 * No extra query per pin: every pin already carries `sol` (the solicitation
 * number) and the first 6 characters of a DoD solicitation number ARE the
 * buying office's DoDAAC. The directory is loaded once and cached in-process,
 * so this is a Map lookup per pin.
 */
import { loadDodaacEarlySignal } from '@/lib/gov-contacts/dodaac-directory';

/** Bands the DB CHECK constraint allows. */
export type EarlySignalBand = 'high' | 'medium' | 'low' | 'none';

export interface EarlySignalPinFields {
  /** Band, only set when the office cleared the sample floor. */
  earlySignal?: EarlySignalBand;
  /** Percent, for a tooltip. Deliberately NOT the primary display — the rate
   *  moves ~10.7 points between periods, so the band is the honest granularity. */
  earlySignalPct?: number;
}

/**
 * The first 6 chars of a solicitation number are a DoDAAC — but ONLY for DoD.
 * Civilian schemes ("PR1610", "IHS152", and literally "REPOST") slice into
 * fragments, which is why this must be shape-checked rather than assumed.
 */
const DODAAC_RE = /^[A-Z0-9]{6}$/;

export function dodaacFromSolicitation(sol: string | null | undefined): string | null {
  const code = String(sol || '').slice(0, 6).toUpperCase();
  return DODAAC_RE.test(code) ? code : null;
}

/**
 * Add earlySignal/earlySignalPct to each pin that has a scored buying office.
 *
 * Fails SOFT: if the directory is unreachable the pins are returned unchanged
 * rather than the map erroring. A missing badge is a small loss; a blank map is
 * a big one.
 */
export async function decorateWithEarlySignal<T extends { sol?: string | null }>(
  pins: T[],
): Promise<Array<T & EarlySignalPinFields>> {
  if (!pins.length) return pins as Array<T & EarlySignalPinFields>;
  let scores: Map<string, { band: EarlySignalBand; pct: number }>;
  try {
    scores = await loadDodaacEarlySignal();
  } catch {
    return pins as Array<T & EarlySignalPinFields>;
  }
  if (!scores.size) return pins as Array<T & EarlySignalPinFields>;

  return pins.map((p) => {
    const dodaac = dodaacFromSolicitation(p.sol);
    if (!dodaac) return p as T & EarlySignalPinFields;
    const s = scores.get(dodaac);
    if (!s) return p as T & EarlySignalPinFields;
    return { ...p, earlySignal: s.band, earlySignalPct: s.pct };
  });
}

/**
 * Filter pins to offices that telegraph work early.
 *
 * 'high' alone is the strict reading (46 offices); 'high'+'medium' is the
 * useful default for "offices worth a relationship" (206 offices). Pins whose
 * office was never scored are EXCLUDED — an unscored office is unknown, not
 * known-good, and quietly including it would inflate the result.
 */
export function filterByEarlySignal<T extends EarlySignalPinFields>(
  pins: T[],
  bands: EarlySignalBand[],
): T[] {
  if (!bands.length) return pins;
  const want = new Set(bands);
  return pins.filter((p) => p.earlySignal !== undefined && want.has(p.earlySignal));
}
