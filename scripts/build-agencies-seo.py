#!/usr/bin/env python3
"""Build a derived agencies SEO dataset from source JSONs.

Output: src/data/agencies-seo.ts (typed array + helpers).

Source-of-truth list = agency-toptier-codes.json (49 federal agencies).
Joined with budget, pain-points, procurement-sources, spending data.
Run after any of those source files change; never hand-edit the output.
"""
import json
import re
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, 'src', 'data')

with open(f'{BASE}/agency-toptier-codes.json') as f:
    toptier = json.load(f)
with open(f'{BASE}/agency-budget-data.json') as f:
    budget = json.load(f)['agencies']
with open(f'{BASE}/agency-pain-points.json') as f:
    pain = json.load(f)['agencies']
with open(f'{BASE}/agency-procurement-sources.json') as f:
    proc = json.load(f)['agencies']
with open(f'{BASE}/agency-spending-complete.json') as f:
    spending_all = json.load(f)['agencies']


def slugify(s: str) -> str:
    s = s.lower()
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s_-]+', '-', s)
    return s.strip('-')


# Index-page grouping. Defense covers DoD + DHS + Corps because they
# share buyer behavior. HHS gets its own bucket because it's the
# civilian giant. Cabinet civilians + independents are split per
# standard fed taxonomy.
CABINET_GROUP = {
    'Department of Defense': 'defense',
    'Department of Homeland Security': 'defense',
    'Corps of Engineers - Civil Works': 'defense',
    'Department of Health and Human Services': 'health',
}

CIVILIAN_GROUP = {
    'Department of Education',
    'Department of Veterans Affairs',
    'Department of Energy',
    'Department of Agriculture',
    'Department of the Treasury',
    'Department of Transportation',
    'Department of Justice',
    'Department of the Interior',
    'Department of Labor',
    'Department of Commerce',
    'Department of State',
    'Department of Housing and Urban Development',
}

INDEPENDENT_GROUP = {
    'Environmental Protection Agency',
    'National Aeronautics and Space Administration',
    'General Services Administration',
    'Small Business Administration',
    'Social Security Administration',
    'Nuclear Regulatory Commission',
    'National Science Foundation',
    'Agency for International Development',
    'Office of Personnel Management',
    'Tennessee Valley Authority',
    'Smithsonian Institution',
}


def find_pain(name):
    if name in pain:
        return name
    short = name.replace('Department of ', '').strip()
    if short in pain:
        return short
    for k in pain:
        if k.lower() == name.lower():
            return k
    return None


def find_proc(name):
    if name in proc:
        return name
    if name.upper() in proc:
        return name.upper()
    aliases = {
        'Department of the Treasury': 'DEPARTMENT OF TREASURY',
    }
    if name in aliases and aliases[name] in proc:
        return aliases[name]
    return None


records = []
for name, info in toptier.items():
    pp_key = find_pain(name)
    pr_key = find_proc(name)
    spend_key = name if name in spending_all else None

    budget_data = budget.get(name)
    fy26_budget_b = None
    fy25_budget_b = None
    trend = None
    pct_change = None
    if budget_data:
        fy26 = budget_data.get('fy2026', {}).get('budgetAuthority', 0)
        fy25 = budget_data.get('fy2025', {}).get('budgetAuthority', 0)
        if fy26:
            fy26_budget_b = round(fy26 / 1e9, 1)
        if fy25:
            fy25_budget_b = round(fy25 / 1e9, 1)
        trend = budget_data.get('change', {}).get('trend')
        pct_change = budget_data.get('change', {}).get('percent')

    pain_obj = pain.get(pp_key, {}) if pp_key else {}
    proc_obj = proc.get(pr_key, {}) if pr_key else {}
    spend_obj = spending_all.get(spend_key, {}) if spend_key else {}

    if name in CABINET_GROUP:
        group = CABINET_GROUP[name]
    elif name in CIVILIAN_GROUP:
        group = 'civilian'
    elif name in INDEPENDENT_GROUP:
        group = 'independent'
    else:
        group = 'small'

    # Filter pain points: drop generic GAO citations, cap at 6.
    raw_pains = pain_obj.get('painPoints', []) or []
    cleaned_pains = []
    for p in raw_pains:
        if not isinstance(p, str):
            continue
        if '(Source: GAO)' in p:
            continue
        cleaned_pains.append(p.strip())
        if len(cleaned_pains) >= 6:
            break

    raw_prio = pain_obj.get('priorities', []) or []
    cleaned_prio = []
    for p in raw_prio:
        if isinstance(p, str):
            cleaned_prio.append(p.strip())
        elif isinstance(p, dict):
            v = p.get('title') or p.get('name')
            if v:
                cleaned_prio.append(v.strip())
        if len(cleaned_prio) >= 5:
            break

    # Procurement secondary sources cleanup
    sec_sources = proc_obj.get('secondarySources', []) if pr_key else []
    cleaned_sec = []
    for s in sec_sources:
        if not isinstance(s, dict):
            continue
        cleaned_sec.append({
            'name': s.get('name', ''),
            'url': s.get('url', ''),
            'type': s.get('type', ''),
            'notes': s.get('notes', ''),
        })

    rec = {
        'slug': slugify(name),
        'name': name,
        'abbreviation': info.get('abbreviation', ''),
        'cgac': info.get('code', ''),
        'group': group,
        'fy26BudgetB': fy26_budget_b,
        'fy25BudgetB': fy25_budget_b,
        'budgetTrend': trend,
        'budgetChangePct': pct_change,
        'painPoints': cleaned_pains,
        'priorities': cleaned_prio,
        'procurement': {
            'primarySources': proc_obj.get('primarySources', []) if pr_key else [],
            'secondarySources': cleaned_sec,
            'spendingPatterns': proc_obj.get('spendingPatterns', {}) if pr_key else {},
            'topVehicles': (proc_obj.get('topVehicles', []) if pr_key else (spend_obj.get('topVehicles', []) if spend_obj else [])),
            'tips': proc_obj.get('tips', '') if pr_key else '',
        },
    }
    records.append(rec)

# Sort by FY26 budget desc; ties broken alphabetically
records.sort(key=lambda r: (-(r['fy26BudgetB'] or 0), r['name']))

out_path = f'{BASE}/agencies-seo.ts'

ts_header = '''/**
 * agencies-seo.ts — Derived dataset for /agencies/* SEO pages.
 *
 * Built from:
 *   - agency-toptier-codes.json   (49 federal agency canonical list)
 *   - agency-budget-data.json     (FY25/FY26 budget authority)
 *   - agency-pain-points.json     (per-agency pain points + priorities)
 *   - agency-procurement-sources.json (where they post opportunities)
 *   - agency-spending-complete.json (contract vehicles + spend patterns)
 *
 * Regenerate via `python3 scripts/build-agencies-seo.py` if source
 * data changes. Do not hand-edit — that will get clobbered on the
 * next regeneration.
 */

export interface AgencyProcurement {
  primarySources: string[];
  secondarySources: Array<{
    name: string;
    url: string;
    type: string;
    notes: string;
  }>;
  spendingPatterns: Record<string, number>;
  topVehicles: Array<{
    name: string;
    manager?: string;
    naics?: string[];
  }>;
  tips: string;
}

export interface AgencySeo {
  slug: string;
  name: string;
  abbreviation: string;
  cgac: string;
  /** index-page grouping: defense | health | civilian | independent | small */
  group: 'defense' | 'health' | 'civilian' | 'independent' | 'small';
  /** FY26 budget authority in $B. null when no source data. */
  fy26BudgetB: number | null;
  fy25BudgetB: number | null;
  budgetTrend: string | null;
  budgetChangePct: number | null;
  painPoints: string[];
  priorities: string[];
  procurement: AgencyProcurement;
}

'''

ts_data = 'export const AGENCIES_SEO: AgencySeo[] = ' + json.dumps(records, indent=2) + ';\n\n'

ts_helpers = '''export const AGENCIES_BY_SLUG: Record<string, AgencySeo> = Object.fromEntries(
  AGENCIES_SEO.map((a) => [a.slug, a]),
);

export function getAgencyBySlug(slug: string): AgencySeo | undefined {
  return AGENCIES_BY_SLUG[slug];
}

export function getAgenciesByGroup(group: AgencySeo['group']): AgencySeo[] {
  return AGENCIES_SEO.filter((a) => a.group === group);
}

/**
 * Related agencies = same group, excluding the focal agency, top 4 by
 * budget. Falls back to top-budget overall when the group is sparse.
 */
export function getRelatedAgencies(agency: AgencySeo, limit = 4): AgencySeo[] {
  const sameGroup = AGENCIES_SEO.filter(
    (a) => a.group === agency.group && a.slug !== agency.slug,
  );
  if (sameGroup.length >= limit) return sameGroup.slice(0, limit);
  const filler = AGENCIES_SEO.filter(
    (a) => a.slug !== agency.slug && !sameGroup.includes(a),
  ).slice(0, limit - sameGroup.length);
  return [...sameGroup, ...filler];
}
'''

with open(out_path, 'w') as f:
    f.write(ts_header)
    f.write(ts_data)
    f.write(ts_helpers)

print(f'Wrote {out_path}')
print(f'Total records: {len(records)}')

from collections import Counter
groups = Counter(r['group'] for r in records)
print('Group counts:')
for g, c in sorted(groups.items()):
    print(f'  {g}: {c}')
print(f'Budget coverage: {sum(1 for r in records if r["fy26BudgetB"])}/{len(records)}')
print(f'Pain-points coverage: {sum(1 for r in records if r["painPoints"])}/{len(records)}')
print(f'Procurement coverage: {sum(1 for r in records if r["procurement"]["primarySources"])}/{len(records)}')
