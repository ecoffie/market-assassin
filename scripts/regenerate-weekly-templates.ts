/**
 * Audit + regenerate weekly templates through the source-grounded pipeline.
 *
 *   npx tsx --env-file=.env.local scripts/regenerate-weekly-templates.ts --audit
 *   npx tsx --env-file=.env.local scripts/regenerate-weekly-templates.ts \
 *     --email=adam.sokolowski01@gmail.com
 *   npx tsx --env-file=.env.local scripts/regenerate-weekly-templates.ts \
 *     --write --all-ungrounded
 *
 * Reconstruct never sends mail. --write upserts briefing_templates only.
 */
import { createClient } from '@supabase/supabase-js';
import { expandNaicsForBriefing } from '@/lib/briefings/naics-briefing-expansion';
import { fetchSamOpportunityNoticeSummaryFromCache } from '@/lib/briefings/pipelines/sam-gov';
import { generateWeeklyDeepDiveFromContracts } from '@/lib/briefings/delivery/weekly-briefing-generator';
import { hashNaicsProfile, naicsProfileKey } from '@/lib/briefings/naics-profile-hash';
import { sanitizeBriefingCalendar } from '@/lib/briefings/calendar-sanitize';
import { weeklyOpportunityGrounding } from '@/lib/briefings/opportunity-sanitize';
import { fetchContractsForProfile } from '@/lib/briefings/weekly-contracts';
import { getPSCsForNAICS } from '@/lib/utils/psc-crosswalk';

const write = process.argv.includes('--write');
const auditOnly = process.argv.includes('--audit');
const allUngrounded = process.argv.includes('--all-ungrounded');
const emailArg = process.argv.find((a) => a.startsWith('--email='))?.slice('--email='.length);
const hashArg = process.argv.find((a) => a.startsWith('--hash='))?.slice('--hash='.length);
const limitArg = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice('--limit='.length) || '25');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('missing supabase env');
  process.exit(2);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

type Profile = {
  naics_codes: string[];
  naics_profile: string;
  naics_profile_hash: string;
  aggregated_psc_codes: string[];
  aggregated_keywords: string[];
  aggregated_agencies: string[];
  user_count: number;
};

function sendWeekOf(now = new Date()): string {
  const dayOfWeek = now.getUTCDay();
  const daysToAdd = dayOfWeek === 1 ? 0 : dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() + daysToAdd);
  return monday.toISOString().split('T')[0];
}

function classifyContent(content: unknown): {
  grounded: number;
  ungrounded: number;
  calendarKept: number;
  calendarDropped: number;
  sampleTitles: string[];
} {
  const briefing = (content || {}) as {
    opportunities?: Array<{ contractName?: string; title?: string }>;
    calendar?: Array<{ date?: string; event?: string; sourceId?: string }>;
  };
  const opps = weeklyOpportunityGrounding(briefing.opportunities || []);
  const cal = sanitizeBriefingCalendar(briefing.calendar || []);
  return {
    grounded: opps.grounded,
    ungrounded: opps.ungrounded,
    calendarKept: cal.kept.length,
    calendarDropped: cal.dropped.length,
    sampleTitles: (briefing.opportunities || []).slice(0, 5).map((o) =>
      String(o.title || o.contractName || '').slice(0, 80),
    ),
  };
}

async function loadProfiles(): Promise<Map<string, Profile>> {
  const { data: users, error } = await sb
    .from('user_notification_settings')
    .select('user_email, naics_codes, keywords, agencies')
    .eq('briefings_enabled', true);
  if (error) throw error;

  const profileMap = new Map<string, Profile>();
  for (const user of users || []) {
    const naicsCodes: string[] = user.naics_codes || [];
    if (naicsCodes.length === 0) continue;
    const hash = hashNaicsProfile(naicsCodes);
    const existing = profileMap.get(hash);
    if (existing) {
      existing.user_count++;
      for (const kw of user.keywords || []) {
        if (!existing.aggregated_keywords.includes(kw)) existing.aggregated_keywords.push(kw);
      }
      for (const agency of user.agencies || []) {
        if (!existing.aggregated_agencies.includes(agency)) existing.aggregated_agencies.push(agency);
      }
      continue;
    }
    profileMap.set(hash, {
      naics_codes: naicsCodes,
      naics_profile: naicsProfileKey(naicsCodes),
      naics_profile_hash: hash,
      aggregated_psc_codes: [],
      aggregated_keywords: [...(user.keywords || [])],
      aggregated_agencies: [...(user.agencies || [])],
      user_count: 1,
    });
  }

  for (const profile of profileMap.values()) {
    const pscSet = new Set<string>();
    for (const naics of profile.naics_codes.slice(0, 5)) {
      for (const match of getPSCsForNAICS(naics, 5)) pscSet.add(match.pscCode);
    }
    profile.aggregated_psc_codes = Array.from(pscSet).slice(0, 10);
  }
  return profileMap;
}

async function regenerate(profile: Profile): Promise<{
  opportunities: Array<{
    sourceId: string;
    title: string;
    status: string;
    marketMatchReason: string;
    agency: string;
    naicsCode?: string;
  }>;
  calendar: Array<{ sourceId: string; date: string; event: string }>;
  contractsFetched: number;
  weekOf: string;
  llmProvider?: string;
  briefing: {
    weekOf: string;
    opportunities: unknown[];
    teamingPlays: unknown[];
    processingTimeMs: number;
    llmProvider?: string;
    llmModel?: string;
  };
}> {
  const expandedNaics = expandNaicsForBriefing(profile.naics_codes);
  const contracts = await fetchContractsForProfile({
    savedNaics: profile.naics_codes,
    expandedNaics,
    pscCodes: profile.aggregated_psc_codes.slice(0, 10),
    keywords: profile.aggregated_keywords.slice(0, 20),
    agencies: profile.aggregated_agencies.slice(0, 10),
  });
  const noticeSummary = await fetchSamOpportunityNoticeSummaryFromCache({
    naicsCodes: expandedNaics,
    pscCodes: profile.aggregated_psc_codes.slice(0, 10),
    keywords: profile.aggregated_keywords.slice(0, 20),
  });
  const briefing = await generateWeeklyDeepDiveFromContracts(contracts, noticeSummary, {
    naicsProfileHash: profile.naics_profile_hash,
    savedNaics: profile.naics_codes,
  });
  return {
    opportunities: briefing.opportunities.map((o) => ({
      sourceId: o.sourceId,
      title: o.title,
      status: o.status,
      marketMatchReason: o.marketMatchReason,
      agency: o.agency,
      naicsCode: o.naicsCode,
    })),
    calendar: briefing.calendar.map((c) => ({ sourceId: c.sourceId, date: c.date, event: c.event })),
    contractsFetched: contracts.length,
    weekOf: briefing.weekOf,
    llmProvider: briefing.llmProvider,
    briefing,
  };
}

async function persist(profile: Profile, briefing: {
  weekOf: string;
  opportunities: unknown[];
  teamingPlays: unknown[];
  processingTimeMs: number;
  llmProvider?: string;
  llmModel?: string;
}, weekOf: string): Promise<void> {
  const { error } = await sb.from('briefing_templates').upsert({
    naics_profile: profile.naics_profile,
    naics_profile_hash: profile.naics_profile_hash,
    template_date: weekOf,
    briefing_type: 'weekly',
    briefing_content: briefing,
    opportunities_count: briefing.opportunities.length,
    teaming_plays_count: Array.isArray(briefing.teamingPlays) ? briefing.teamingPlays.length : 0,
    processing_time_ms: briefing.processingTimeMs,
    llm_provider: briefing.llmProvider || 'unknown',
    llm_model: briefing.llmModel || 'unknown',
    generated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: 'naics_profile_hash,template_date,briefing_type' });
  if (error) throw error;
}

async function main() {
  const weekOf = sendWeekOf();
  const { data: templates, error: tErr } = await sb
    .from('briefing_templates')
    .select('naics_profile_hash, naics_profile, template_date, briefing_content, generated_at')
    .eq('briefing_type', 'weekly')
    .range(0, 1999);
  if (tErr) throw tErr;

  const classified = (templates || []).map((row) => ({
    hash: row.naics_profile_hash as string,
    profile: row.naics_profile as string,
    templateDate: row.template_date as string,
    generatedAt: row.generated_at as string,
    thisWeek: row.template_date === weekOf,
    ...classifyContent(row.briefing_content),
  }));
  const thisWeek = classified.filter((row) => row.thisWeek);
  const ungroundedThisWeek = thisWeek.filter((row) => row.ungrounded > 0 || row.grounded === 0);
  const allUngroundedRows = classified.filter((row) => row.ungrounded > 0 || row.grounded === 0);

  const audit = {
    asOf: new Date().toISOString(),
    weekOf,
    weeklyTemplateRows: classified.length,
    thisWeekTemplates: thisWeek.length,
    thisWeekUngrounded: ungroundedThisWeek.length,
    anyDateUngrounded: allUngroundedRows.length,
    thisWeekSample: thisWeek.slice(0, 12),
    ungroundedThisWeekHashes: ungroundedThisWeek.map((row) => row.hash),
  };

  if (auditOnly) {
    console.log(JSON.stringify(audit, null, 2));
    return;
  }

  const profiles = await loadProfiles();
  const targets: Profile[] = [];

  if (emailArg) {
    const { data: settings, error: sErr } = await sb
      .from('user_notification_settings')
      .select('user_email, naics_codes, keywords, agencies, briefings_enabled')
      .eq('user_email', emailArg.toLowerCase().trim())
      .maybeSingle();
    if (sErr) throw sErr;
    if (!settings) {
      console.error('no notification settings for', emailArg);
      process.exit(1);
    }
    const hash = hashNaicsProfile(settings.naics_codes || []);
    const grouped = profiles.get(hash);
    const profile: Profile = grouped || {
      naics_codes: settings.naics_codes || [],
      naics_profile: naicsProfileKey(settings.naics_codes || []),
      naics_profile_hash: hash,
      aggregated_psc_codes: [],
      aggregated_keywords: [...(settings.keywords || [])],
      aggregated_agencies: [...(settings.agencies || [])],
      user_count: 1,
    };
    if (!grouped) {
      const pscSet = new Set<string>();
      for (const naics of profile.naics_codes.slice(0, 5)) {
        for (const match of getPSCsForNAICS(naics, 5)) pscSet.add(match.pscCode);
      }
      profile.aggregated_psc_codes = Array.from(pscSet).slice(0, 10);
    }
    targets.push(profile);
    const cached = classified.find((row) => row.hash === hash && row.thisWeek)
      || classified.find((row) => row.hash === hash);
    console.log(JSON.stringify({
      mode: 'reconstruct-no-send',
      email: emailArg.toLowerCase().trim(),
      briefingsEnabled: settings.briefings_enabled,
      cachedTemplate: cached || null,
      write,
    }, null, 2));
  } else if (hashArg) {
    const grouped = profiles.get(hashArg);
    if (!grouped) {
      console.error('no enabled-user profile for hash', hashArg);
      process.exit(1);
    }
    targets.push(grouped);
  } else if (allUngrounded) {
    for (const row of ungroundedThisWeek.slice(0, Number.isFinite(limitArg) ? limitArg : 25)) {
      const grouped = profiles.get(row.hash);
      if (grouped) targets.push(grouped);
    }
  } else {
    console.log(JSON.stringify({ ...audit, hint: 'pass --audit, --email=, --hash=, or --write --all-ungrounded' }, null, 2));
    return;
  }

  const results = [];
  for (const profile of targets) {
    const generated = await regenerate(profile) as unknown as {
      opportunities: Array<{ sourceId: string; title: string; status: string; marketMatchReason: string; agency: string; naicsCode?: string }>;
      calendar: Array<{ sourceId: string; date: string; event: string }>;
      contractsFetched: number;
      weekOf: string;
      llmProvider?: string;
      briefing: {
        weekOf: string;
        opportunities: unknown[];
        teamingPlays: unknown[];
        processingTimeMs: number;
        llmProvider?: string;
        llmModel?: string;
      };
    };
    const grounding = weeklyOpportunityGrounding(generated.briefing.opportunities as never);
    const calendar = sanitizeBriefingCalendar(generated.calendar);
    if (write) {
      if (grounding.grounded === 0) {
        results.push({
          hash: profile.naics_profile_hash,
          skippedWrite: true,
          reason: 'no source-grounded opportunities',
          contractsFetched: generated.contractsFetched,
        });
        continue;
      }
      await persist(profile, generated.briefing, weekOf);
    }
    results.push({
      hash: profile.naics_profile_hash,
      profile: profile.naics_profile,
      userCount: profile.user_count,
      contractsFetched: generated.contractsFetched,
      llmProvider: generated.llmProvider,
      weekOf: generated.weekOf,
      templateDate: weekOf,
      wrote: write,
      opportunities: generated.opportunities,
      calendar: calendar.kept,
      calendarDropped: calendar.dropped.length,
      grounding,
    });
  }

  console.log(JSON.stringify({ audit, results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
