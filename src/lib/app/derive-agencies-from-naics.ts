/**
 * deriveAgenciesFromProfile — the top buying agencies for a user's profile.
 *
 * KEYWORD-FIRST (Eric 2026-07-02): NAICS is too general ("541110 = Offices of
 * Lawyers" pulls 91 agencies). The user's keyword ("medical supplies") is a tighter,
 * more relevant signal AND has far better coverage (38% of users have a keyword vs
 * 13% custom NAICS; only 0.4% have PSC). So scan by keyword when present, fall back
 * to NAICS. PSC would be the most precise axis but almost nobody has it yet — we're
 * nudging PSC adoption separately so we can prefer it later.
 *
 * The gap this originally closed: the slurpee/auto-setup scanned buying agencies but
 * wrote them to user_target_list (Pro), never to user_notification_settings.agencies
 * (what the alerts profile + Decision Makers read). This is the single source of that
 * derivation, reused by both profile-save seeding and the Decision Makers teaser.
 *
 * Reuses the EXISTING public find-agencies scan (no auth, no tier gate). Keyword-
 * primary uses its marketFilter path (which skips the NAICS filter). Returns real
 * agency names ranked by spend; empty on failure (callers degrade gracefully).
 */

interface ScanAgency {
  name?: string;
  subAgency?: string;
  parentAgency?: string;
  contractingOffice?: string;
}

async function scan(base: string, body: Record<string, unknown>): Promise<string[]> {
  try {
    const r = await fetch(`${base}/api/usaspending/find-agencies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return [];
    const j = await r.json();
    return (Array.isArray(j?.agencies) ? j.agencies : []).map((a: ScanAgency) =>
      // Prefer the operational sub-agency ("Department of the Army") over the broad
      // parent ("Department of Defense") — the contact directory keys on the
      // operating agency. Fall back to name, then parent.
      (a.subAgency || a.name || a.parentAgency || '').trim(),
    ).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * @param opts.keywords user's keywords (first is used as the primary scan term)
 * @param opts.naics    user's NAICS (fallback / merge)
 * @param base absolute origin for the internal fetch (find-agencies is same-app)
 * @param limit max agency names to return
 * @returns deduped agency names ranked by scan spend order
 */
export async function deriveAgenciesFromProfile(
  opts: { keywords?: string[]; naics?: string[] },
  base: string,
  limit = 10,
): Promise<string[]> {
  const keyword = (opts.keywords || []).map((k) => String(k).trim()).filter(Boolean)[0];
  const codes = (opts.naics || []).map((c) => String(c).trim()).filter(Boolean).slice(0, 3);

  const merged: string[] = [];
  const seen = new Set<string>();
  const add = (labels: string[]) => {
    for (const label of labels) {
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(label);
      if (merged.length >= limit) return true;
    }
    return false;
  };

  // 1) KEYWORD-FIRST — the more precise, better-covered signal. Uses the keyword-
  // primary marketFilter path (find-agencies skips the NAICS filter when this is set).
  if (keyword) {
    const done = add(await scan(base, {
      marketFilter: { keywords: [keyword], mode: 'keyword', rankingLabel: `keyword "${keyword}"` },
    }));
    if (done || merged.length >= limit) return merged.slice(0, limit);
  }

  // 2) NAICS fallback (or top-up if keyword returned few). Scan the top codes, merge.
  for (const code of codes) {
    if (add(await scan(base, { naicsCode: code }))) break;
  }

  return merged.slice(0, limit);
}

/**
 * Back-compat shim for the original NAICS-only signature. Prefer
 * deriveAgenciesFromProfile with keywords.
 * @deprecated use deriveAgenciesFromProfile
 */
export async function deriveAgenciesFromNaics(
  naicsCodes: string[],
  base: string,
  limit = 10,
): Promise<string[]> {
  return deriveAgenciesFromProfile({ naics: naicsCodes }, base, limit);
}
