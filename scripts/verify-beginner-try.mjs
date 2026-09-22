/**
 * verify-beginner-try — SAM-cache oracle for /try.
 *
 * USASpending coverage is award history. /try shows OPEN notices from
 * sam_opportunities. This script never calls USASpending.
 *
 * Oracle: if the cache has an active title containing the distinctive user
 * noun, /try must not say "nothing matching is open" or ask a follow-up.
 * If nothing is open but Award Notices in the same table match, /try shows
 * those as "Recently awarded" — not empty. Empty is allowed only when the
 * noun is absent from both open notices and Award Notices.
 *
 * BigQuery task-order fallback is NOT in this oracle. A live keyword scan of
 * usaspending.awards is ~2.6 GiB; 1000 sample queries would blow the 5 GiB
 * job ceiling. Tests stub searchTaskOrders; production only runs BQ when
 * open SAM is empty.
 *
 * Two layers:
 *   1. Pinned regressions (lidar sentence, fix doors, janitorial, HVAC
 *      ≠ Dale Carnegie, "I do stuff" follow-up, garbage → empty).
 *   2. Reverse sample: distinctive nouns taken FROM live titles, wrapped in
 *      beginner sentences. By construction the cache contains the noun.
 *
 * ⚠️ WHAT THE SAMPLE DOES AND DOES NOT MEASURE.
 * It is a RECALL floor, not a precision score. Each noun is harvested from a
 * live open title, so a relevant listing provably exists; the only assertions
 * are that /try does not come back EMPTY and does not ask a follow-up. It says
 * nothing about whether the other results are any good — a run that returned
 * the whole corpus for every input would score 1000/1000. Precision lives in
 * the pinned regressions above and in the frozen set
 * (src/lib/beginner/__fixtures__/try-relevance-cases.ts), which assert
 * include/exclude per record. Two further limits: the corpus is one PostgREST
 * page (1,000 rows), not a census, and the four frames are templates, not real
 * user prose.
 *
 * Run:  npm run verify:beginner-try
 *       npm run verify:beginner-try -- --sample 250
 *       npm run verify:beginner-try -- --json
 *       npm run verify:beginner-try -- --pinned   (skip the sample pass)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const JSON_OUT = process.argv.includes('--json');
const PINNED_ONLY = process.argv.includes('--pinned');
const sampleIdx = process.argv.indexOf('--sample');
const SAMPLE = sampleIdx >= 0 ? Math.max(1, Number(process.argv[sampleIdx + 1]) || 250) : 250;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('✗ missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n  Run: vercel env pull .env.local');
  process.exit(2);
}
const sb = createClient(url, key);

const { beginnerDirectKeyword, searchBeginnerHiddenMarket, toHiddenMarketLandingView } =
  await import('@/lib/beginner/hidden-market');
const { isDistinctiveKeyword } = await import('@/lib/market/keyword-sanitize');
const { stripBuyerNames } = await import('@/lib/beginner/relevance');

const todayIso = new Date().toISOString();
const SELECT =
  'title, department, naics_code, set_aside_description, notice_type, response_deadline, ui_link, solicitation_number, posted_date';

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  if (!JSON_OUT) {
    console.log((pass ? '\x1b[32m✓\x1b[0m ' : '\x1b[31m✗ FAIL\x1b[0m ') + name + '  \x1b[2m' + detail + '\x1b[0m');
  }
}

function escapeIlike(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// ⚠️ NO `notice_id` here. Harmless today (nothing reads it), but it is why the
// removed detail-evidence fallback got ZERO coverage from this oracle while it
// reported 13/13 — every candidate was skipped before any fetch. A future
// body-relevance feature MUST add it, or this file will pass with that feature
// disabled. See tasks/body-relevance-followup-2026-09-21.md.
function toItem(row) {
  return {
    title: row.title ?? null,
    agency: row.department ?? null,
    naics: row.naics_code ?? null,
    set_aside: row.set_aside_description ?? null,
    type: row.notice_type ?? null,
    deadline: row.response_deadline ?? null,
    solicitation: row.solicitation_number ?? null,
    link: row.ui_link ?? null,
  };
}

function deriveEmpty() {
  return {
    keywords: [],
    _meta: { grounded: false, degraded: false, ranked: false, keyword_count: 0, input_chars: 20 },
  };
}

function cacheSearch(rows, keyword, limit = 40) {
  const k = (keyword || '').toLowerCase();
  if (!k) return [];
  return rows.filter((r) => (r.title || '').toLowerCase().includes(k)).slice(0, limit).map(toItem);
}

async function liveTitleSearch(keyword, limit = 40) {
  const { data, error } = await sb
    .from('sam_opportunities')
    .select(SELECT)
    .eq('active', true)
    .gte('response_deadline', todayIso)
    .ilike('title', `%${escapeIlike(keyword)}%`)
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data || []).map(toItem);
}

async function liveAwardSearch(keyword, limit = 40) {
  const { data, error } = await sb
    .from('sam_opportunities')
    .select(SELECT)
    .ilike('notice_type', '%award%')
    .ilike('title', `%${escapeIlike(keyword)}%`)
    .order('posted_date', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data || []).map(toItem);
}

async function runTry(description, searchSam, searchAwarded) {
  const result = await searchBeginnerHiddenMarket(
    { description },
    {
      deriveKeywords: async () => deriveEmpty(),
      searchSam,
      searchAwarded,
      // Never hit the warehouse from this oracle (see header).
      searchTaskOrders: async () => ({ ok: true, count: 0, items: [] }),
    },
  );
  const view = toHiddenMarketLandingView(result);
  return { result, view };
}

function frames(token) {
  return [token, `I do ${token}`, `work with ${token} for government`, `I fix ${token}`];
}

const NOT_A_BUSINESS_NOUN = new Set([
  'replace', 'repair', 'install', 'restore', 'rebuild', 'refinish', 'fix',
  'contract', 'contracts', 'award', 'awards', 'solicitation', 'notice',
  'building', 'buildings', 'service', 'services', 'support', 'system', 'systems',
  'program', 'management', 'team', 'training', 'work', 'project', 'unit', 'units',
]);

function distinctiveTokensFromTitle(title) {
  // ⚠️ Strip ORGANISATION names before harvesting. 7 of the 8 live titles
  // containing "engineers" are "U.S. Army Corps of Engineers" — the BUYER.
  // Mining a buyer's name as a business noun makes the harness demand results
  // for "I do engineers", and the relevance gate is right to give none.
  const words = stripBuyerNames(String(title || ''))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const w of words) {
    if (w.length < 5 || seen.has(w) || /^\d+$/.test(w)) continue;
    if (NOT_A_BUSINESS_NOUN.has(w)) continue;
    if (!isDistinctiveKeyword(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

// ── 1. PINNED REGRESSIONS (live cache, not USASpending) ─────────────────────
{
  const PINNED = [
    {
      description: 'work with lidar for uas drones',
      expect: 'results',
      titleMust: /lidar/i,
    },
    {
      description: 'fix doors',
      expect: 'results',
      titleMust: /door/i,
    },
    {
      description: 'I clean office buildings',
      expect: 'results',
      titleMust: /clean|janitor|custodial|housekeep/i,
    },
    {
      description: 'I do window washing',
      expect: 'results',
      titleMust: /window/i,
    },
    {
      description: 'I do stuff',
      expect: 'need_followup',
    },
    // ── /try relevance batch, 2026-09-21 ────────────────────────────────
    // THE SCREENSHOT INPUT. Before the fix this searched the literal word
    // "person" (out of "2 person") and returned 13 results: a personnel-
    // security platform, a PERSONAL alert device and PERSONAL services
    // contractors. It must now find waste work, or nothing.
    {
      description: 'can a 2 person garbage company do government contracts',
      expect: 'results',
      titleMust: /garbage|trash|refuse|waste|sanitation/i,
      titleMustNot: /personnel|personal|hypersonic|warhead/i,
    },
    {
      description: 'physical security guard services',
      expect: 'results',
      titleMust: /guard|security/i,
      // "Coast Guard"/"National Guard" are BUYERS; a grill/cattle/snow guard
      // is a part. None may appear as a described match.
      titleMustNot: /coast guard|national guard|grill guard|cattle guard|snow guard|lifeguard/i,
    },
    {
      description: 'I own a landscaping business',
      expect: 'results',
      titleMust: /landscap|grounds|mowing/i,
    },
    // Every content word is company/meta context — the honest answer is a
    // question, not a confident list of unrelated contracts.
    {
      description: 'I help businesses',
      expect: 'need_followup',
    },
    // ── EXACT-TOKEN MISS IS NOT MARKET ABSENCE (2026-09-21) ─────────────
    // Zero open TITLES contain "lawn" or "mowing", while ~18 open
    // grounds-maintenance notices (NAICS 561730) are exactly this business.
    // Whatever we show, the words must never claim the market is empty.
    {
      description: 'we mow lawns',
      expect: 'no_market_absence_claim',
    },
    {
      description: 'staffing agency',
      expect: 'no_market_absence_claim',
    },
    {
      description: 'zzqwxjunkterm999xyz',
      expect: 'no_cards',
    },
  ];

  for (const pin of PINNED) {
    try {
      const { result, view } = await runTry(
        pin.description,
        async ({ keyword, limit }) => {
          const items = await liveTitleSearch(keyword, limit ?? 40);
          return { ok: true, count: items.length, items };
        },
        async ({ keyword, limit }) => {
          const items = await liveAwardSearch(keyword, limit ?? 40);
          return { ok: true, count: items.length, items };
        },
      );
      if (pin.expect === 'need_followup') {
        const ok = view.outcome === 'need_followup' || result.resolution.state === 'need_followup';
        record(`pinned "${pin.description}" → follow-up`, ok, `outcome=${view.outcome} state=${result.resolution.state}`);
        continue;
      }
      if (pin.expect === 'no_market_absence_claim') {
        const blob = `${view.message || ''} ${view.reveal?.explanation || ''} ${(view.reveal?.limitations || []).join(' ')}`;
        const banned = /nothing matching is open|the open market is small|0 current opportunit|no opportunities exist/i;
        const bad = blob.match(banned);
        const names = /not a reading of the market|not a sign that nothing is open|limit of this search/i.test(blob);
        record(
          `pinned "${pin.description}" → miss, not absence`,
          !bad && names,
          bad ? `CLAIMED ABSENCE: "${bad[0]}"` : names ? 'copy names the search limit' : 'copy does not name the search limit',
        );
        continue;
      }
      if (pin.expect === 'no_cards') {
        const ok =
          (view.directCards || []).length === 0 &&
          (view.uncoveredCards || []).length === 0 &&
          view.outcome !== 'results';
        record(`pinned "${pin.description}" → honest miss`, ok, `outcome=${view.outcome} cards=${view.directCards.length}`);
        continue;
      }
      const cards = [...(view.directCards || []), ...(view.uncoveredCards || [])];
      const titled = cards.filter((c) => pin.titleMust.test(c.title || ''));
      // A described match must never carry a forbidden sense of the word.
      const leaked = pin.titleMustNot
        ? (view.directCards || []).filter((c) => pin.titleMustNot.test(c.title || ''))
        : [];
      const ok =
        view.outcome === 'results' && cards.length > 0 && titled.length > 0 && leaked.length === 0;
      record(
        `pinned "${pin.description}" → results`,
        ok,
        `outcome=${view.outcome} keyword=${result.directKeyword} ${titled.length}/${cards.length} title-hit` +
          (leaked.length ? ` LEAKED: ${leaked.map((c) => c.title).join(' | ')}` : ''),
      );
    } catch (e) {
      record(`pinned "${pin.description}"`, false, 'threw: ' + (e?.message || e));
    }
  }

  try {
    const { view } = await runTry('I install HVAC in buildings', async ({ keyword, limit }) => {
      const items = await liveTitleSearch(keyword, limit ?? 40);
      return { ok: true, count: items.length, items };
    });
    const leak = (view.directCards || []).some((c) => /Dale Carnegie/i.test(c.title || ''));
    record('pinned HVAC ↛ Dale Carnegie training', !leak, leak ? 'Dale Carnegie leaked into HVAC cards' : 'no Dale Carnegie in HVAC cards');
  } catch (e) {
    record('pinned HVAC ↛ Dale Carnegie training', false, 'threw: ' + (e?.message || e));
  }
}

// ── 2. REVERSE SAMPLE from live titles ──────────────────────────────────────
if (!PINNED_ONLY) {
  const { data, error } = await sb
    .from('sam_opportunities')
    .select(SELECT)
    .eq('active', true)
    .gte('response_deadline', todayIso)
    .limit(1000);
  if (error) {
    record('sample: load sam_opportunities', false, error.message);
  } else {
    const corpus = data || [];
    record('sample: load sam_opportunities', corpus.length > 0, `${corpus.length} active open rows (PostgREST page, not a census)`);

    const tokenSet = [];
    const seenTok = new Set();
    for (const row of corpus) {
      for (const tok of distinctiveTokensFromTitle(row.title)) {
        if (seenTok.has(tok)) continue;
        seenTok.add(tok);
        tokenSet.push(tok);
        if (tokenSet.length >= SAMPLE) break;
      }
      if (tokenSet.length >= SAMPLE) break;
    }

    let combinations = 0;
    let falseEmpty = 0;
    let falseFollowup = 0;
    let okCount = 0;
    const failures = [];

    for (const token of tokenSet) {
      for (const description of frames(token)) {
        combinations += 1;
        const kw = beginnerDirectKeyword(description);
        const cacheHits = kw ? cacheSearch(corpus, kw, 5) : [];
        const { view, result } = await runTry(description, async ({ keyword, limit }) => {
          const items = cacheSearch(corpus, keyword, limit ?? 40);
          return { ok: true, count: items.length, items };
        });

        if (cacheHits.length === 0) {
          // Honest miss inside this 1000-row page if the direct keyword drifted
          // off the source token. Not a false-empty.
          okCount += 1;
          continue;
        }

        if (NOT_A_BUSINESS_NOUN.has((kw || '').toLowerCase())) {
          okCount += 1;
          continue;
        }

        if (view.outcome === 'need_followup' || result.resolution.state === 'need_followup') {
          falseFollowup += 1;
          if (failures.length < 40) {
            failures.push({ kind: 'false_followup', description, keyword: kw, cacheHits: cacheHits.length });
          }
          continue;
        }

        if (view.outcome === 'empty' || (view.directCards || []).length === 0) {
          falseEmpty += 1;
          if (failures.length < 40) {
            failures.push({
              kind: 'false_empty',
              description,
              keyword: kw,
              cacheHits: cacheHits.length,
              sampleTitle: cacheHits[0]?.title,
            });
          }
          continue;
        }
        okCount += 1;
      }
    }

    const pass = falseEmpty === 0 && falseFollowup === 0 && combinations > 0;
    record(
      `sample ${tokenSet.length} nouns × 4 frames = ${combinations} searches (RECALL floor only — asserts not-empty / not-follow-up, makes NO precision claim)`,
      pass,
      `ok=${okCount} false-empty=${falseEmpty} false-followup=${falseFollowup}`,
    );
    if (!JSON_OUT && failures.length) {
      for (const f of failures.slice(0, 15)) {
        console.log(`    \x1b[2m${f.kind}: "${f.description}" kw=${f.keyword} cacheHits=${f.cacheHits}${f.sampleTitle ? ` e.g. ${f.sampleTitle}` : ''}\x1b[0m`);
      }
    }
    if (JSON_OUT) {
      results.push({ name: 'sample-failures', pass, detail: failures });
    }
  }
}

const failed = results.filter((r) => r.pass === false);
if (JSON_OUT) {
  console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
} else {
  console.log(
    '\n' +
      (failed.length === 0
        ? `\x1b[32m✓ all ${results.length} /try cache oracles passed\x1b[0m`
        : `\x1b[31m✗ ${failed.length}/${results.length} /try cache oracles FAILED\x1b[0m`),
  );
}
process.exit(failed.length === 0 ? 0 : 1);
