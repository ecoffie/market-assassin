/**
 * "Start a proposal" from the opportunity attached to Ask Mindy (approved plan, step 4, 2026-11-16).
 * Only ever runs on the user's click; Mindy never writes on its own.
 *
 *   1. POST /api/pipeline {user_email, title, notice_id, …} → the pursuit row. A 409 means it is already
 *      tracked and carries that row (no duplicate is created).
 *   2. Documents: a NEW pursuit already fetches its SAM documents (fetchPursuitDocsAuto, scheduled by the
 *      pipeline route with after()). An EXISTING pursuit whose documents never arrived gets
 *      POST /api/app/proposal/pursuit-docs, which runs fetchPursuitDocsAuto for it. One fetch, never two.
 *   3. Open /app?panel=proposals&pursuit_id=<user_pipeline.id>.
 *
 * The Map drawer has an ES5 copy of this inline (route.ts, ASK_MINDY_JS); start-proposal-parity.unit.test.ts
 * keeps the two in step.
 */
export interface ProposalNotice { notice_id: string; title: string; deadline?: string }
export type StartProposalResult =
  | { ok: true; pursuitId: string; href: string; created: boolean; docsRequested: boolean }
  | { ok: false; reason: 'invalid_notice' | 'save_failed' | 'no_pursuit_id' };

type Fetcher = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Docs states that need no new fetch: already there, or a fetch is running. */
export const DOCS_SETTLED = new Set(['ready', 'loaded', 'fetching']);

export function proposalHref(pursuitId: string): string {
  return `/app?panel=proposals&pursuit_id=${encodeURIComponent(pursuitId)}`;
}

export async function startProposalFromNotice(fetcher: Fetcher, email: string, notice: ProposalNotice): Promise<StartProposalResult> {
  const id = String(notice.notice_id || '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(id)) return { ok: false, reason: 'invalid_notice' };
  const body: Record<string, unknown> = {
    user_email: email,
    title: notice.title?.trim() || 'SAM.gov opportunity',
    notice_id: id,
    source: 'ask_mindy',
  };
  if (notice.deadline) body.response_deadline = notice.deadline;
  let res;
  try {
    res = await fetcher('/api/pipeline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, reason: 'save_failed' };
  }
  if (!res.ok && res.status !== 409) return { ok: false, reason: 'save_failed' };
  const d = (await res.json().catch(() => null)) as { opportunity?: { id?: unknown; docs_status?: unknown } } | null;
  const pursuitId = d?.opportunity?.id ? String(d.opportunity.id) : '';
  if (!pursuitId) return { ok: false, reason: 'no_pursuit_id' };
  const created = res.status !== 409;
  let docsRequested = false;
  if (!created && !DOCS_SETTLED.has(String(d?.opportunity?.docs_status ?? ''))) {
    docsRequested = true;
    // Best effort: the Proposals panel shows the documents' state and offers a retry itself.
    fetcher(`/api/app/proposal/pursuit-docs?email=${encodeURIComponent(email)}&pipeline_id=${encodeURIComponent(pursuitId)}`, { method: 'POST' }).catch(() => {});
  }
  return { ok: true, pursuitId, href: proposalHref(pursuitId), created, docsRequested };
}
