/**
 * /jobs — GovCon jobs on getmindy.ai, read from the stored contractor_job_postings table
 * (filled daily by /api/cron/sync-contractor-jobs). While that table is empty, it shows the
 * govcongiants.com job board's feed instead (src/lib/jobs/funnels-feed.ts).
 *
 * noindex for now: govcongiants.com/jobs already ranks for these searches, and a second copy
 * on another domain would compete with it. Flip once there's a decision on which site owns them.
 */
import type { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';
import PublicShell from '@/components/public-site/PublicShell';
import { JOB_ROLES } from '@/lib/jobs/categories';
import { readJobBoard, type JobBoardData, type JobBoardFilters } from '@/lib/jobs/read';
import { readJobBoardFromFunnels } from '@/lib/jobs/funnels-feed';
import { normalizeStateCode } from '@/lib/utils/us-states';
import JobsBoard from './JobsBoard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'GovCon jobs: who is hiring in government contracting — Mindy',
  description: 'Business development, capture, proposal and contracts jobs at government contractors and federal agencies, updated daily.',
  alternates: { canonical: '/jobs' },
  robots: { index: false, follow: true },
};

const UNAVAILABLE: JobBoardData = {
  state: 'unavailable',
  source: 'mindy',
  error: 'Supabase not configured',
  totals: { active: null, contractor: null, federal: null, cleared: null, contingent: null },
  listings: [],
  topEmployers: [],
  agenciesHiring: [],
  lastSyncedAt: null,
};

type SP = Promise<Record<string, string | string[] | undefined>>;

function parseFilters(sp: Record<string, string | string[] | undefined>): JobBoardFilters {
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const source = one('source');
  const role = one('role');
  const clearance = one('clearance');
  const state = one('state');
  return {
    source: source === 'jsearch' || source === 'usajobs' ? source : undefined,
    role: role && JOB_ROLES.some((r) => r.slug === role) ? role : undefined,
    clearance: clearance === 'required' || clearance === 'none-stated' ? clearance : undefined,
    state: state ? normalizeStateCode(state) ?? undefined : undefined,
  };
}

export default async function JobsPage({ searchParams }: { searchParams: SP }) {
  const filters = parseFilters(await searchParams);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stored =
    url && key
      ? await readJobBoard(createClient(url, key, { auth: { persistSession: false } }), filters)
      : UNAVAILABLE;
  // Until Mindy's own daily sync has postings (API keys not set yet), show the govcongiants.com
  // job board's feed. A stored table with rows always wins.
  const data = stored.state === 'ok' && (stored.totals.active ?? 0) > 0 ? stored : await readJobBoardFromFunnels(filters);

  return (
    <PublicShell contentElement="div">
      <JobsBoard data={data} filters={filters} />
    </PublicShell>
  );
}
