/**
 * GovCon business-development role categories, ported from govcon-funnels
 * (src/lib/job-categories.ts — the "9 GovCon BD jobs that pay $150K+" roles).
 * Title keyword match, first category wins; everything else is 'other'.
 */
export const JOB_ROLES = [
  { slug: 'proposal-coordinator', name: 'Proposal Coordinator', keywords: ['proposal coordinator', 'proposal specialist', 'proposal analyst', 'proposal support', 'proposal associate'] },
  { slug: 'pricing-analyst', name: 'Pricing Analyst', keywords: ['pricing analyst', 'cost analyst', 'pricing manager', 'cost estimator', 'pricing specialist'] },
  { slug: 'contracts-administrator', name: 'Contracts Administrator', keywords: ['contract administrator', 'contract specialist', 'contracts administrator', 'contracts manager', 'subcontracts'] },
  { slug: 'capture-manager', name: 'Capture Manager', keywords: ['capture manager', 'capture lead', 'capture specialist'] },
  { slug: 'bd-manager', name: 'BD Manager', keywords: ['business development manager', 'bd manager', 'business development lead', 'business development representative', 'business development executive'] },
  { slug: 'proposal-manager', name: 'Proposal Manager', keywords: ['proposal manager', 'proposal director', 'proposal lead', 'proposal writer'] },
  { slug: 'capture-director', name: 'Capture Director', keywords: ['capture director', 'director of capture', 'director, capture'] },
  { slug: 'vp-business-development', name: 'VP Business Development', keywords: ['vp business development', 'vice president bd', 'vice president business development', 'vp of business development', 'svp business development'] },
  { slug: 'bd-consultant', name: 'BD Consultant', keywords: ['bd consultant', 'capture consultant', 'proposal consultant', 'govcon consultant'] },
] as const;

export type JobRoleSlug = (typeof JOB_ROLES)[number]['slug'] | 'other';

export function categorizeJob(title: string): JobRoleSlug {
  const t = (title || '').toLowerCase();
  for (const role of JOB_ROLES) {
    if (role.keywords.some((k) => t.includes(k))) return role.slug;
  }
  return 'other';
}

export function roleName(slug: string): string | null {
  return JOB_ROLES.find((r) => r.slug === slug)?.name ?? null;
}
