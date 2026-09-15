/**
 * Blind acceptance: five FIND markets against live Supabase.
 * Usage: npx tsx --env-file=.env.local scripts/accept-find-opportunities.mts
 */
import { findOpportunities } from '../src/lib/opportunities/find-opportunities.ts';
import { creditsFor, isMcpTool, listMcpTools } from '../src/lib/mcp/tool-registry.ts';

const CASES = [
  {
    id: '1_cyber_fl',
    label: 'cybersecurity in Florida',
    input: { query: 'cybersecurity', location: 'Florida', limit_per_horizon: 5 },
  },
  {
    id: '2_cleaning_va',
    label: 'commercial cleaning in Virginia',
    input: { query: 'commercial cleaning', location: 'Virginia', limit_per_horizon: 5 },
  },
  {
    id: '3_construction_installation',
    label: 'construction near MacDill AFB',
    input: { query: 'construction MacDill AFB', location: 'Florida', limit_per_horizon: 5 },
  },
  {
    id: '4_it_agency',
    label: 'IT for Department of Veterans Affairs',
    input: { query: 'information technology', agency: 'Veterans Affairs', limit_per_horizon: 5 },
  },
  {
    id: '5_no_open_recompete_forecast',
    label: 'janitorial in Wyoming (expect empty open, coming-back activity)',
    input: { query: 'janitorial services', location: 'Wyoming', limit_per_horizon: 5 },
  },
] as const;

function summarizeHorizon(h: Awaited<ReturnType<typeof findOpportunities>>['horizons']['open_now']) {
  return {
    status: h.status,
    matched_count: h.matched_count,
    returned_count: h.returned_count,
    unmapped_count: h.unmapped_count,
    filters_unsupported: h.filters_unsupported,
    allowed_handoffs: h.allowed_handoffs,
    error: h.error,
    sample_titles: h.items.slice(0, 2).map((i) => i.title),
  };
}

async function main() {
  // Compatibility proofs
  const tools = listMcpTools().map((t) => (t as { function: { name: string } }).function.name);
  const proof = {
    find_opportunities_registered: isMcpTool('find_opportunities'),
    find_opportunities_credits: creditsFor('find_opportunities'),
    search_sam_still_registered: isMcpTool('search_sam_opportunities'),
    search_sam_credits: creditsFor('search_sam_opportunities'),
    catalog_has_find: tools.includes('find_opportunities'),
    catalog_has_sam: tools.includes('search_sam_opportunities'),
    catalog_count: tools.length,
  };
  console.log('COMPAT', JSON.stringify(proof, null, 2));

  const results = [];
  for (const c of CASES) {
    const started = Date.now();
    const r = await findOpportunities({ ...c.input });
    const elapsed_ms = Date.now() - started;
    const row = {
      id: c.id,
      label: c.label,
      elapsed_ms,
      headline: r.summary.headline,
      find_shape: r._meta.find_shape,
      grounded: r._meta.grounded,
      degraded: r._meta.degraded,
      watch_coverage: r._meta.watch_coverage,
      summary: r.summary,
      horizons: {
        open_now: summarizeHorizon(r.horizons.open_now),
        coming_back: summarizeHorizon(r.horizons.coming_back),
        coming_soon: summarizeHorizon(r.horizons.coming_soon),
      },
      _next: r._next,
      // Critical acceptance language support
      can_say_no_open_but_others:
        r.horizons.open_now.status === 'empty' &&
        (r.horizons.coming_back.status === 'grounded' || r.horizons.coming_soon.status === 'grounded'),
      open_only_still_valid:
        r.horizons.open_now.status === 'grounded' &&
        (r.horizons.coming_back.status === 'empty' || r.horizons.coming_back.status === 'unavailable') &&
        (r.horizons.coming_soon.status === 'empty' || r.horizons.coming_soon.status === 'unavailable'),
      never_market_zero_from_open_alone:
        !(r.horizons.open_now.status === 'empty' &&
          !r._meta.grounded &&
          (r.horizons.coming_back.status === 'grounded' || r.horizons.coming_soon.status === 'grounded')),
    };
    results.push(row);
    console.log('\n===', c.id, c.label, '===');
    console.log(JSON.stringify(row, null, 2));
  }

  // Dedicated inverse + cyber critical checks
  const cyber = results.find((x) => x.id === '1_cyber_fl')!;
  console.log('\nCRITICAL_CYBER_FL', {
    headline: cyber.headline,
    open: cyber.horizons.open_now.status,
    back: cyber.horizons.coming_back.status,
    soon: cyber.horizons.coming_soon.status,
    grounded: cyber.grounded,
    can_say_no_open_but_others: cyber.can_say_no_open_but_others,
    _next_prompt: cyber._next[0]?.prompt,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
