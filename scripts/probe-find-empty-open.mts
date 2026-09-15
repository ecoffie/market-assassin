import { findOpportunities } from '../src/lib/opportunities/find-opportunities';

async function main() {
  const probes = [
    { query: 'janitorial services', location: 'Wyoming', limit_per_horizon: 5 },
    { query: 'demolition', location: 'Alaska', limit_per_horizon: 5 },
    { query: 'roofing', location: 'Vermont', limit_per_horizon: 5 },
    { query: 'cybersecurity', location: 'Florida', limit_per_horizon: 5 },
    // Prove open-empty narrative without tuning: disable is not used; try nonsense open + real recompete NAICS
    { query: 'zzzznonexistentopenphrase', location: 'Florida', advanced: { naics: '541512' }, limit_per_horizon: 5 },
  ];
  for (const p of probes) {
    const r = await findOpportunities(p as Parameters<typeof findOpportunities>[0]);
    console.log(JSON.stringify({
      input: p,
      headline: r.summary.headline,
      open: r.summary.open_now,
      back: r.summary.coming_back,
      soon: r.summary.coming_soon,
      shape: r._meta.find_shape,
      can_say_no_open_but_others:
        r.horizons.open_now.status === 'empty' &&
        (r.horizons.coming_back.status === 'grounded' || r.horizons.coming_soon.status === 'grounded'),
      open_samples: r.horizons.open_now.items.slice(0, 3).map((i) => i.title),
      next: r._next.map((n) => n.prompt.slice(0, 70)),
    }, null, 2));
  }
}
main();
