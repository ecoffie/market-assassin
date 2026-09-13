/**
 * Read-only, no-send reconstruction of daily alert / paid briefing / weekly
 * plus population counts for the paid-access defects.
 *
 *   npx tsx --env-file=/tmp/ma-prod.clean.env scripts/repro-paid-surfaces.ts \
 *     --email=adam.sokolowski01@gmail.com
 *
 * Never sends mail. Never writes customer rows.
 */
import { createClient } from '@supabase/supabase-js';
import { fetchSamOpportunitiesFromCache, scoreOpportunity } from '@/lib/briefings/pipelines/sam-gov';
import { applyOpenAlertMode, filterMarketToSavedIndustry } from '@/lib/alerts/open-contract-d';
import { alertModeFromAggregated } from '@/lib/alerts/alert-mode';
import { getPSCsForNAICS } from '@/lib/utils/psc-crosswalk';
import { expandNAICSCodes } from '@/lib/utils/naics-expansion';
import { buildSamGreenBriefing } from '@/lib/briefings/delivery/sam-green-email-template';
import { hashNaicsProfile } from '@/lib/briefings/naics-profile-hash';
import { sanitizeBriefingCalendar } from '@/lib/briefings/calendar-sanitize';
import { weeklyOpportunityGrounding } from '@/lib/briefings/opportunity-sanitize';
import { distinctiveKeywords, keywordHitPassages } from '@/lib/market/keyword-sanitize';
import { BRIEFING_ENTITLED_ACCESS } from '@/lib/briefings/delivery/rollout';
import { PAID_LEDGER_REASONS } from '@/lib/mcp/extraction-guard';

const emailArg = process.argv.find((a) => a.startsWith('--email='))?.slice('--email='.length);
const email = (emailArg || '').toLowerCase().trim();
if (!email) {
  console.error('usage: --email=<addr>');
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('missing supabase env');
  process.exit(2);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

function summarizeOpp(opp: {
  noticeId: string;
  title: string;
  naicsCode: string;
  postedDate: string;
  department?: string;
  score?: number;
  inMarket?: boolean;
  distinctiveHits?: string[];
  keywordPassages?: Array<{ keyword: string; field: string; passage: string }>;
}) {
  return {
    noticeId: opp.noticeId,
    title: opp.title.slice(0, 90),
    naics: opp.naicsCode,
    posted: opp.postedDate,
    agency: (opp.department || '').slice(0, 40),
    score: opp.score ?? null,
    inMarket: opp.inMarket ?? null,
    distinctiveHits: opp.distinctiveHits ?? [],
    keywordPassages: opp.keywordPassages ?? [],
  };
}

async function main() {
  const { data: settings, error: sErr } = await sb
    .from('user_notification_settings')
    .select('user_email, naics_codes, keywords, agencies, location_states, business_type, business_description, aggregated_profile, alerts_enabled, alert_frequency, briefings_enabled, is_active, paid_status, treatment_type, last_alert_sent')
    .eq('user_email', email)
    .limit(1)
    .maybeSingle();
  if (sErr) throw sErr;
  if (!settings) {
    console.error('no notification settings');
    process.exit(1);
  }

  const userNaics: string[] = settings.naics_codes || [];
  const userKeywords: string[] = settings.keywords || [];
  const userPscManual: string[] = [];
  const expandedNaics = expandNAICSCodes(userNaics, false);
  const relatedPSCs: string[] = [];
  for (const naics of userNaics.slice(0, 3)) {
    relatedPSCs.push(...getPSCsForNAICS(naics, 3).map((p) => p.pscCode));
  }
  const uniquePSCs = [...new Set(relatedPSCs)];
  const effectivePsc = userPscManual.length > 0 ? userPscManual : uniquePSCs;
  const distinctive = distinctiveKeywords(userKeywords);

  const alertCache = await fetchSamOpportunitiesFromCache({
    naicsCodes: expandedNaics,
    pscCodes: effectivePsc.length > 0 ? effectivePsc : undefined,
    keywords: userKeywords,
    states: settings.location_states || undefined,
    limit: 200,
    savedNaics: userNaics,
  });
  const alertApplied = applyOpenAlertMode(
    {
      rows: alertCache.opportunities,
      distinctiveMatchCount: alertCache.distinctiveMatchCount ?? alertCache.keywordMatchCount ?? 0,
      outcome: alertCache.openKeywordOutcome ?? 'no_keywords_configured',
    },
    alertModeFromAggregated(settings.aggregated_profile),
    userKeywords,
  );
  const alertBeforeIndustry = alertApplied.rows;
  const alertIndustry = filterMarketToSavedIndustry(
    alertBeforeIndustry,
    userNaics,
    (o) => o.naicsCode,
  );
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  const newBefore = alertBeforeIndustry.filter((o) => o.postedDate && new Date(o.postedDate) >= oneDayAgo);
  const newAfter = alertIndustry.rows.filter((o) => o.postedDate && new Date(o.postedDate) >= oneDayAgo);

  const annotate = (rows: typeof alertBeforeIndustry) =>
    rows.slice(0, 8).map((opp) => {
      return summarizeOpp({
        ...opp,
        score: scoreOpportunity(opp, {
          naics_codes: userNaics,
          agencies: settings.agencies || [],
          keywords: userKeywords,
          business_description: settings.business_description,
        }),
        inMarket: alertIndustry.rows.includes(opp),
        distinctiveHits: distinctive.filter((k) =>
          `${opp.title} ${opp.description}`.toLowerCase().includes(k.toLowerCase()),
        ),
        keywordPassages: keywordHitPassages(
          { title: opp.title, description: opp.description },
          userKeywords,
        ),
      });
    });

  const briefingCache = await fetchSamOpportunitiesFromCache({
    naicsCodes: userNaics.slice(0, 10),
    pscCodes: userPscManual.slice(0, 10),
    keywords: userKeywords.slice(0, 10),
    states: (settings.location_states || []).slice(0, 10),
    limit: 250,
    savedNaics: userNaics,
  });
  const briefingApplied = applyOpenAlertMode(
    {
      rows: briefingCache.opportunities,
      distinctiveMatchCount: briefingCache.distinctiveMatchCount ?? briefingCache.keywordMatchCount ?? 0,
      outcome: briefingCache.openKeywordOutcome ?? 'no_keywords_configured',
    },
    alertModeFromAggregated(settings.aggregated_profile),
    userKeywords,
  );
  const briefingIndustry = filterMarketToSavedIndustry(
    briefingApplied.rows,
    userNaics,
    (o) => o.naicsCode,
  );
  const green = buildSamGreenBriefing(briefingIndustry.rows, {
    naicsCodes: userNaics,
    agencies: settings.agencies || [],
    keywords: userKeywords,
    businessType: settings.business_type,
    businessDescription: settings.business_description,
  });

  const naicsHash = hashNaicsProfile(userNaics);
  const { data: exactWeekly, error: wErr } = await sb
    .from('briefing_templates')
    .select('naics_profile_hash, naics_profile, briefing_type, briefing_content')
    .eq('briefing_type', 'weekly')
    .eq('naics_profile_hash', naicsHash)
    .limit(1)
    .maybeSingle();
  if (wErr) throw wErr;

  let weeklyMatch: {
    matchType: string;
    hash?: string;
    profile?: string;
    calendarDropped?: number;
    calendarKept?: number;
    opps?: number;
    opportunityGrounding?: { grounded: number; ungrounded: number };
    sampleTitles?: string[];
  } = {
    matchType: exactWeekly ? 'exact' : 'none',
  };
  if (exactWeekly) {
    const content = exactWeekly.briefing_content as { calendar?: { date: string; event: string }[]; opportunities?: { contractName?: string; title?: string }[] };
    const cal = sanitizeBriefingCalendar(content.calendar || []);
    weeklyMatch = {
      matchType: 'exact',
      hash: exactWeekly.naics_profile_hash,
      profile: String(exactWeekly.naics_profile),
      calendarDropped: cal.dropped.length,
      calendarKept: cal.kept.length,
      opps: content.opportunities?.length ?? 0,
      opportunityGrounding: weeklyOpportunityGrounding(content.opportunities || []),
      sampleTitles: (content.opportunities || []).slice(0, 5).map((o) => String(o.contractName || o.title || '').slice(0, 80)),
    };
  } else {
    const prefixes = [...new Set(userNaics.map((c) => String(c).replace(/\D/g, '').slice(0, 3)).filter((p) => p.length === 3))];
    const { data: weeklyTemplates, error: tErr } = await sb
      .from('briefing_templates')
      .select('naics_profile_hash, naics_profile, briefing_content')
      .eq('briefing_type', 'weekly')
      .limit(400);
    if (tErr) throw tErr;
    const ranked = (weeklyTemplates || [])
      .map((t) => {
        let profile: string[] = [];
        try { profile = JSON.parse(String(t.naics_profile || '[]')); } catch { profile = []; }
        const score = profile.reduce((n: number, code: string) => {
          const p = String(code).replace(/\D/g, '').slice(0, 3);
          return n + (prefixes.includes(p) ? p.length : 0);
        }, 0);
        return { t, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (best) {
      const content = best.t.briefing_content as { calendar?: { date: string; event: string }[]; opportunities?: { contractName?: string; title?: string }[] };
      const cal = sanitizeBriefingCalendar(content.calendar || []);
      weeklyMatch = {
        matchType: 'prefix',
        hash: best.t.naics_profile_hash,
        profile: String(best.t.naics_profile),
        calendarDropped: cal.dropped.length,
        calendarKept: cal.kept.length,
        opps: content.opportunities?.length ?? 0,
        opportunityGrounding: weeklyOpportunityGrounding(content.opportunities || []),
        sampleTitles: (content.opportunities || []).slice(0, 5).map((o) => String(o.contractName || o.title || '').slice(0, 80)),
      };
    }
  }

  const entitled = [...BRIEFING_ENTITLED_ACCESS];
  const [{ count: accessNoClass, error: e1 }, { count: kvLabelFree, error: e2 }, { count: appTierNoPaidReason, error: e3 }, { count: prefixWeekly, error: e4 }] = await Promise.all([
    sb.from('user_profiles').select('email', { count: 'exact', head: true }).eq('access_briefings', true),
    sb.from('user_profiles').select('email', { count: 'exact', head: true }).eq('access_briefings', true).eq('tier', 'free'),
    sb.from('mcp_credit_ledger').select('user_email', { count: 'exact', head: true }).in('reason', ['app_tier_pro', 'app_tier_team']),
    sb.from('briefing_log').select('id', { count: 'exact', head: true }).contains('tools_included', ['prefix_fallback_template']).gte('created_at', '2026-08-01'),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  if (e4) throw e4;

  const entitledEmails = new Set<string>();
  for (let from = 0; from < 20000; from += 1000) {
    const { data: classRows, error: cErr } = await sb
      .from('customer_classifications')
      .select('email, briefings_access')
      .in('briefings_access', entitled)
      .range(from, from + 999);
    if (cErr) throw cErr;
    for (const r of classRows || []) {
      const e = String(r.email || '').toLowerCase();
      if (e) entitledEmails.add(e);
    }
    if (!classRows || classRows.length < 1000) break;
  }

  // access_briefings true but classification not entitled — page because of PostgREST cap
  const { data: flaggedProfiles, error: pErr } = await sb
    .from('user_profiles')
    .select('email, access_briefings, tier')
    .eq('access_briefings', true)
    .range(0, 4999);
  if (pErr) throw pErr;
  const accessWithoutEntitledClass = (flaggedProfiles || []).filter((r) => !entitledEmails.has(String(r.email || '').toLowerCase()));

  const { data: treatmentFree, error: tFreeErr } = await sb
    .from('user_notification_settings')
    .select('user_email, paid_status, treatment_type, briefings_enabled')
    .eq('paid_status', true)
    .eq('treatment_type', 'free')
    .range(0, 4999);
  if (tFreeErr) throw tFreeErr;

  const { data: purchasesNullSession, error: purchErr } = await sb
    .from('purchases')
    .select('user_email, product_name, amount_paid, stripe_session_id')
    .ilike('product_name', '%mindy ai%')
    .is('stripe_session_id', null)
    .range(0, 1999);
  if (purchErr) throw purchErr;

  const { data: ledgerAppTier, error: ledErr } = await sb
    .from('mcp_credit_ledger')
    .select('user_email, reason')
    .in('reason', ['app_tier_pro', 'app_tier_team'])
    .range(0, 4999);
  if (ledErr) throw ledErr;
  const appTierEmails = [...new Set((ledgerAppTier || []).map((r) => String(r.user_email || '').toLowerCase()))];
  const { data: paidReasonRows, error: prErr } = await sb
    .from('mcp_credit_ledger')
    .select('user_email, reason')
    .in('reason', ['stripe_topup', 'pro_monthly', 'admin_grant'])
    .range(0, 4999);
  if (prErr) throw prErr;
  const oldPaidReasons = new Set((paidReasonRows || []).map((r) => String(r.user_email || '').toLowerCase()));
  const appTierWithoutOldPaid = appTierEmails.filter((e) => !oldPaidReasons.has(e));

  let unsubEmails: string[] = [];
  let currentlyEnabledAfterUnsub: number | 'unknown' = 'unknown';
  const { data: unsubClicks, error: uErr } = await sb
    .from('user_engagement')
    .select('user_email, created_at, event_type, metadata')
    .eq('event_type', 'email_click')
    .gte('created_at', '2026-08-01')
    .range(0, 1999);
  if (uErr) {
    console.error('unsub query failed (kept unknown):', uErr.message);
  } else {
    unsubEmails = [...new Set(
      (unsubClicks || [])
        .filter((r) => JSON.stringify(r.metadata || {}).toLowerCase().includes('unsubscribe'))
        .map((r) => String(r.user_email || '').toLowerCase())
        .filter(Boolean),
    )];
    if (unsubEmails.length > 0) {
      const { data: after, error: aErr } = await sb
        .from('user_notification_settings')
        .select('user_email, alerts_enabled, alert_frequency')
        .in('user_email', unsubEmails.slice(0, 200))
        .range(0, 199);
      if (!aErr) {
        currentlyEnabledAfterUnsub = (after || []).filter((r) => r.alerts_enabled === true && r.alert_frequency !== 'paused').length;
      }
    } else {
      currentlyEnabledAfterUnsub = 0;
    }
  }

  const out = {
    asOf: new Date().toISOString(),
    email,
    profile: {
      naics: userNaics,
      keywords: userKeywords,
      distinctive,
      pscManual: userPscManual,
      autoPsc: uniquePSCs,
      alerts_enabled: settings.alerts_enabled,
      alert_frequency: settings.alert_frequency,
      briefings_enabled: settings.briefings_enabled,
      paid_status: settings.paid_status,
      treatment_type: settings.treatment_type,
      last_alert_sent: settings.last_alert_sent,
    },
    dailyAlert: {
      fetchCount: alertCache.opportunities.length,
      openOutcome: alertApplied.outcome,
      distinctiveMatchCount: alertApplied.distinctiveMatchCount,
      droppedOffIndustry: alertIndustry.droppedOffIndustry,
      newLast24hBeforeFilter: newBefore.length,
      newLast24hAfterFilter: newAfter.length,
      sampleBeforeFilter: annotate(newBefore.length ? newBefore : alertBeforeIndustry),
      sampleAfterFilter: annotate(newAfter.length ? newAfter : alertIndustry.rows),
    },
    paidBriefing: {
      fetchCount: briefingCache.opportunities.length,
      openOutcome: briefingApplied.outcome,
      distinctiveMatchCount: briefingApplied.distinctiveMatchCount,
      droppedOffIndustry: briefingIndustry.droppedOffIndustry,
      rankedTitles: green.opportunities.map((o) => ({
        rank: o.rank,
        title: o.title.slice(0, 90),
        naics: o.naicsCode,
        posted: o.postedDate,
        deadline: o.responseDeadline,
      })),
      offSavedSixDigit: green.opportunities.filter((o) => !userNaics.includes(o.naicsCode || '')).map((o) => o.naicsCode),
    },
    weekly: weeklyMatch,
    population: {
      accessBriefingsTrue: accessNoClass,
      accessBriefingsTrueTierFree: kvLabelFree,
      accessBriefingsWithoutEntitledClassification: accessWithoutEntitledClass.length,
      accessBriefingsWithoutEntitledSample: accessWithoutEntitledClass.slice(0, 15).map((r) => r.email),
      paidStatusTrueTreatmentFree: (treatmentFree || []).length,
      mindyAiPurchasesNullSession: (purchasesNullSession || []).length,
      ledgerAppTierRows: appTierNoPaidReason,
      appTierEmailsWithoutOldPaidReasons: appTierWithoutOldPaid.length,
      prefixFallbackWeeklySinceAug: prefixWeekly,
      unsubscribeClicksSinceAug: unsubEmails.length,
      unsubClickStillAlertsEnabled: currentlyEnabledAfterUnsub,
      paidLedgerReasonsNow: [...PAID_LEDGER_REASONS],
    },
    unknown: [
      'support@getmindy.ai mailbox not readable from this environment',
      'historical matcher version on Sep 13 alert_log not stored',
      'whether unsubscribe GET persisted before the Sep 12 save overwrote it',
    ],
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
