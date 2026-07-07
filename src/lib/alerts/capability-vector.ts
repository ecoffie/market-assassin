/**
 * Per-user capability VECTOR for semantic "hidden match" alerts (Phase 3).
 *
 * Builds the same capability blob deriveSemanticKeywords()/vault-prefill assemble
 * (one_liner + elevator_pitch + capabilities + past-perf scope + NAICS titles),
 * embeds it ONCE, and caches the vector on user_identity_profile so the daily-alert
 * loop never embeds 1,300+ users per send. Refreshed only when the profile changes
 * (the vault write routes null `capability_embedded_at`; the backfill cron drains).
 *
 * Reuses embedText from src/lib/market/embeddings.ts. Eligibility gate: skip thin /
 * AI-sample profiles so we never fire "matches your capabilities" noise at the users
 * least able to judge it (the flagged risk).
 */
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { embedText, parseEmbedding } from '@/lib/market/embeddings';
import { getNaics } from '@/lib/codes/lookup';
import { fetchUSASpendingAwardsByUei } from '@/lib/usaspending/awards-by-uei';
import { DEFAULT_NAICS_CODES } from '@/lib/config/defaults';

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Minimum real-content signal before a user is eligible for hidden matches.
const MIN_BLOB_CHARS = 120;        // a one-liner alone (~60 chars) is not enough
const MIN_REAL_SIGNALS = 1;        // ≥1 real capability OR ≥1 imported past-perf scope

// The known SEED SWEEPS we must NEVER treat as a real capability signal (memory:
// prefilled_naics_not_real_signal). Two placeholder sets get written to profiles at
// signup/onboarding; embedding them fires "matches your capabilities" noise at exactly
// the users least able to judge it. `free-profile.ts` writes the 541-IT sweep;
// `config/defaults.ts` DEFAULT_NAICS_CODES is the healthcare nudge default.
const SEED_SWEEP_IT = ['541512', '541611', '541330', '541990', '561210'];
const SEED_NAICS = new Set<string>([...SEED_SWEEP_IT, ...DEFAULT_NAICS_CODES]);

// Generic keyword sets that ride along with the seed sweeps — real signal requires
// something beyond these. (The 541-sweep onboarding seeds exactly these words.)
const GENERIC_KEYWORDS = new Set<string>([
  'computer', 'systems', 'design', 'administrative', 'management', 'engineering',
  'professional', 'scientific', 'technical', 'facilities', 'services', 'support',
]);

/**
 * Is this notification-settings NAICS set the placeholder seed sweep (not a real
 * user choice)? True when EVERY code is a known seed code (an all-seed profile is a
 * default nobody edited). A user who kept the sweep but ADDED their own code is real.
 */
function isSeedNaicsOnly(naics: string[]): boolean {
  const real = naics.map((n) => String(n).trim()).filter(Boolean);
  if (real.length === 0) return true;
  return real.every((n) => SEED_NAICS.has(n));
}

/** Keywords count as real signal only if at least one is NOT in the generic seed set. */
function hasRealKeyword(keywords: string[]): boolean {
  return keywords.some((k) => {
    const t = String(k).trim().toLowerCase();
    return t.length > 2 && !GENERIC_KEYWORDS.has(t);
  });
}

export interface CapabilityProfile {
  email: string;
  blob: string;
  hash: string;
  eligible: boolean;        // has real (non-placeholder) capability/past-perf text
  realSignals: number;
}

/** Strip obvious AI-coach placeholder/sample text so it doesn't count as real signal. */
function isPlaceholder(text: string): boolean {
  const t = (text || '').toLowerCase();
  if (!t.trim()) return true;
  return /\[(.*?)\]/.test(t)                      // [placeholder] brackets
    || /\b(sample|example|placeholder|your capability|describe your)\b/.test(t);
}

/**
 * Assemble the capability blob for one user from the 3 vault tables, mirroring
 * vault/prefill's deriveSemanticKeywords input. Returns eligibility + a stable hash
 * of the meaning text (so we only re-embed when it actually changed).
 */
export async function buildCapabilityProfile(email: string): Promise<CapabilityProfile> {
  const supabase = admin();
  const e = email.toLowerCase().trim();

  const [identityRes, capsRes, ppRes] = await Promise.all([
    supabase.from('user_identity_profile')
      .select('one_liner, elevator_pitch, primary_naics, uei')
      .eq('user_email', e).maybeSingle(),
    supabase.from('user_capabilities_library')
      .select('capability_name, description')
      .eq('user_email', e).is('archived_at', null),
    supabase.from('user_past_performance')
      .select('scope_description, contract_title, agency')
      .eq('user_email', e).is('archived_at', null),
  ]);

  const identity = (identityRes.data || {}) as { one_liner?: string | null; elevator_pitch?: string | null; primary_naics?: string[] | null; uei?: string | null };
  const caps = (capsRes.data || []) as Array<{ capability_name?: string; description?: string }>;
  const pp = (ppRes.data || []) as Array<{ scope_description?: string }>;

  const capStrings = caps
    .map((c) => `${c.capability_name || ''} ${c.description || ''}`.trim())
    .filter(Boolean);
  const scopeStrings = pp.map((p) => (p.scope_description || '').trim()).filter(Boolean);

  // Count REAL (non-placeholder) signals for eligibility.
  const realCaps = capStrings.filter((s) => !isPlaceholder(s)).length;
  const realScopes = scopeStrings.filter((s) => !isPlaceholder(s) && s.length > 30).length;
  let realSignals = realCaps + realScopes;

  // UEI fallback (Eric, Jun 2026): a user who entered a UEI but never SAVED a Vault
  // (didn't click "accept" on prefill) has no capabilities/past-perf rows → 0
  // realSignals → no vector → no hidden matches. But their UEI gives us their REAL
  // award history from USASpending. Pull those scope descriptions and use them as
  // capability signal — so any UEI user gets a real, grounded vector automatically,
  // not just those who completed the Vault. Only fetch when saved content is thin
  // (don't waste the API call when the Vault already qualifies).
  if (realSignals < MIN_REAL_SIGNALS && identity.uei) {
    const awards = await fetchUSASpendingAwardsByUei(identity.uei, 15).catch(() => []);
    for (const a of awards) {
      const scope = (a.scope_description || '').trim();
      if (scope && !isPlaceholder(scope) && scope.length > 30) {
        scopeStrings.push(scope);
        realSignals++;
      }
    }
  }

  let naicsArr: string[] = Array.isArray(identity.primary_naics) ? identity.primary_naics as string[] : [];
  const extraKeywordTitles: string[] = [];

  // BASE-WIDE FALLBACK (Phase 1 v2): the Vault + UEI paths reach almost nobody
  // (user_identity_profile is ~32 rows). The real base-wide profile lives on
  // user_notification_settings (~10k rows) as user-chosen NAICS + keywords. When we
  // still have no real signal, ground a vector from THAT — but ONLY when it's a real
  // profile, never the seed sweep (prefilled_naics_not_real_signal). This is what
  // finally lets hidden-match fire for users with no UEI and no completed Vault.
  if (realSignals < MIN_REAL_SIGNALS) {
    const { data: ns } = await supabase
      .from('user_notification_settings')
      .select('naics_codes, keywords')
      .eq('user_email', e).maybeSingle();

    const nsNaics: string[] = Array.isArray(ns?.naics_codes) ? (ns!.naics_codes as string[]) : [];
    const nsKeywords: string[] = Array.isArray(ns?.keywords) ? (ns!.keywords as string[]) : [];

    // Only a NON-seed NAICS set OR a keyword set with real (non-generic) terms counts.
    const realNaics = !isSeedNaicsOnly(nsNaics);
    const realKw = hasRealKeyword(nsKeywords);

    if (realNaics || realKw) {
      // Prefer the user's real NAICS for titles; fold in their keywords as meaning text.
      if (realNaics && naicsArr.length === 0) naicsArr = nsNaics;
      if (realKw) {
        for (const k of nsKeywords) {
          const t = String(k).trim();
          if (t.length > 2 && !GENERIC_KEYWORDS.has(t.toLowerCase())) extraKeywordTitles.push(t);
        }
      }
      // Count this as one real signal so eligibility passes — it IS a real, user-chosen
      // profile, just expressed as codes/keywords instead of prose.
      realSignals++;
    }
  }

  const naicsTitles = naicsArr.map((n) => getNaics(String(n))?.title || '').filter(Boolean);

  const blob = [
    identity.one_liner,
    identity.elevator_pitch,
    ...capStrings,
    ...naicsTitles,
    ...extraKeywordTitles,
    ...scopeStrings,
  ].filter(Boolean).join('. ').slice(0, 8000);

  const hash = createHash('sha1').update(blob).digest('hex');
  const eligible = blob.trim().length >= MIN_BLOB_CHARS && realSignals >= MIN_REAL_SIGNALS;

  return { email: e, blob, hash, eligible, realSignals };
}

/**
 * Embed the user's capability blob and store the vector + hash on
 * user_notification_settings — the base-wide home (~10k rows; every active user has
 * a row). Stamps capability_embedded_at even when SKIPPED/empty so the backfill cron
 * doesn't loop on the same row.
 * Returns: 'embedded' | 'skipped' (ineligible/empty) | 'unchanged' (hash match).
 *
 * NOTE: writes go to user_notification_settings, NOT user_identity_profile. The
 * legacy 32 identity-profile vectors remain readable via getCapabilityVector's
 * fallback, but all NEW/refreshed vectors land on notification_settings so hidden
 * match reaches the whole base.
 */
export async function embedAndStoreCapabilityVector(email: string): Promise<'embedded' | 'skipped' | 'unchanged'> {
  const supabase = admin();
  const e = email.toLowerCase().trim();
  const profile = await buildCapabilityProfile(e);

  // Read current hash to skip re-embedding unchanged meaning text.
  const { data: cur } = await supabase
    .from('user_notification_settings')
    .select('capability_embed_source_hash, capability_embedding')
    .eq('user_email', e).maybeSingle();

  const stamp = new Date().toISOString();

  if (!profile.eligible) {
    // Ineligible (thin/placeholder/seed-sweep) — clear any stale vector, stamp so we don't retry.
    await supabase.from('user_notification_settings')
      .update({ capability_embedding: null, capability_embed_source_hash: profile.hash, capability_embedded_at: stamp })
      .eq('user_email', e);
    return 'skipped';
  }

  if (cur?.capability_embed_source_hash === profile.hash && parseEmbedding(cur?.capability_embedding)) {
    // Meaning unchanged + vector present → just stamp.
    await supabase.from('user_notification_settings').update({ capability_embedded_at: stamp }).eq('user_email', e);
    return 'unchanged';
  }

  const vec = await embedText(profile.blob);
  await supabase.from('user_notification_settings')
    .update({ capability_embedding: vec, capability_embed_source_hash: profile.hash, capability_embedded_at: stamp })
    .eq('user_email', e);
  return 'embedded';
}

/**
 * Mark a user's capability vector stale so the backfill cron re-embeds it. Call
 * after any vault capability/past-performance write OR any NAICS/keyword profile
 * change (those live in other tables, so they can't null the row directly).
 * Fire-and-forget; never throws. Nulls the stamp on user_notification_settings (the
 * base-wide home). Non-fatal if the column doesn't exist yet (migration pending).
 */
export async function invalidateCapabilityVector(email: string): Promise<void> {
  try {
    await admin()
      .from('user_notification_settings')
      .update({ capability_embedded_at: null })
      .eq('user_email', email.toLowerCase().trim());
  } catch { /* column may not exist yet / non-fatal */ }
}

/**
 * Read a user's cached capability vector (null if absent/ineligible).
 * Reads user_notification_settings first (the base-wide home), then falls back to
 * user_identity_profile for the legacy ~32 users whose vector predates the move.
 * Both reads are guarded so a not-yet-applied migration returns null, not a throw.
 */
export async function getCapabilityVector(email: string): Promise<number[] | null> {
  const supabase = admin();
  const e = email.toLowerCase().trim();

  try {
    const { data } = await supabase
      .from('user_notification_settings')
      .select('capability_embedding')
      .eq('user_email', e)
      .maybeSingle();
    const vec = parseEmbedding(data?.capability_embedding);
    if (vec) return vec;
  } catch { /* column may not exist yet / non-fatal */ }

  // Legacy fallback: the 32 identity-profile users embedded before the base-wide move.
  const { data: legacy } = await supabase
    .from('user_identity_profile')
    .select('capability_embedding')
    .eq('user_email', e)
    .maybeSingle();
  return parseEmbedding(legacy?.capability_embedding);
}
