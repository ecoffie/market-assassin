/**
 * SANITIZED ACCOUNT FIXTURES for the legacy-retirement browser acceptance.
 *
 * Synthetic identities on the reserved `.invalid` TLD (RFC 2606) — they cannot receive mail
 * and cannot collide with a real customer. They REPRESENT account shapes measured read-only on
 * 2026-09-23; they are NOT Adam's or Andre's accounts and nothing here reads or impersonates
 * either of them.
 *
 *   paid-briefings  ← shape of a $149 Mindy Pro buyer: KV `briefings:`=true, no `ma:`
 *   legacy-comp     ← shape of a comp/advocate with a legacy tool grant: KV `contentgen:`
 *                     full-fix + `briefings:`=true, no purchases row
 *   ma-purchaser    ← an existing standalone Market Assassin buyer: KV `ma:` premium ONLY
 *                     (no briefings), plus the legacy `ma_access_email` cookie in the browser
 *   no-grant        ← CONTROL: signed in, no entitlement at all (must stay free)
 *
 * Every fixture has a saved profile (so /app's normal landing applies, not onboarding) and one
 * saved pursuit (representative saved work). Values are invented; no customer data.
 */
export const FIXTURE_DOMAIN = 'acceptance.invalid';
const at = (local) => `${local}@${FIXTURE_DOMAIN}`;
const NOW = '2026-09-23T12:00:00.000Z';

export const FIXTURES = {
  'paid-briefings': {
    email: at('paid-briefings'),
    kv: { briefings: true },
    maCookie: null,
    expectTier: 'pro',
  },
  'legacy-comp': {
    email: at('legacy-comp'),
    kv: {
      briefings: true,
      contentgen: { email: at('legacy-comp'), customerName: 'Fixture', tier: 'full-fix', createdAt: NOW, productId: 'govcon-content-generator' },
    },
    maCookie: null,
    expectTier: 'pro',
  },
  'ma-purchaser': {
    email: at('ma-purchaser'),
    kv: { ma: { email: at('ma-purchaser'), tier: 'premium', createdAt: NOW } },
    maCookie: at('ma-purchaser'),
    expectTier: 'pro',
  },
  'no-grant': {
    email: at('no-grant'),
    kv: {},
    maCookie: null,
    expectTier: 'free',
  },
};

/** KV keys exactly as production writes them (src/lib/access-codes.ts, briefings/access.ts). */
export function kvSeed() {
  const out = {};
  for (const f of Object.values(FIXTURES)) {
    for (const [prefix, value] of Object.entries(f.kv)) out[`${prefix}:${f.email}`] = JSON.stringify(value);
  }
  return out;
}

/** Row shapes use the real column names of the production tables (read 2026-09-23). */
export function supabaseRows(table, email) {
  const f = Object.values(FIXTURES).find((x) => x.email === email);
  if (!f) return [];
  const slug = email.split('@')[0];
  if (table === 'user_notification_settings') {
    return [{
      id: `00000000-0000-4000-8000-${slug.length.toString().padStart(12, '0')}`,
      user_email: email, naics_codes: ['541512', '541611'], keywords: ['cybersecurity'],
      agencies: [], psc_codes: [], location_states: [], business_type: '', alerts_enabled: false,
      alert_frequency: 'weekly', briefings_enabled: false, timezone: 'America/New_York',
      is_active: true, trial_ends_at: null, created_at: NOW, updated_at: NOW,
    }];
  }
  if (table === 'user_pipeline') {
    return [{
      id: `fixture-pursuit-${slug}`, user_email: email, owner_email: email, workspace_id: null,
      notice_id: null, title: `Fixture saved pursuit (${slug})`, agency: 'Department of Fixtures',
      stage: 'tracking', priority: 'medium', naics_code: '541512', set_aside: null,
      response_deadline: null, value_estimate: null, win_probability: null, notes: null,
      next_action: null, next_action_date: null, is_archived: false, is_prime: true,
      source: 'acceptance-fixture', external_url: null, award_amount: null, bid_decision: null,
      bid_decided_at: null, bid_decided_by: null, bid_score: null, collaborators: [],
      teaming_partners: [], docs_count: 0, docs_status: null, docs_fetched_at: null,
      family_id: null, needs_me_today: false, outcome_date: null, outcome_notes: null,
      winner: null, work_category: null, discovered_at: NOW, created_at: NOW, updated_at: NOW,
      created_by: email, updated_by: email,
    }];
  }
  return [];
}
