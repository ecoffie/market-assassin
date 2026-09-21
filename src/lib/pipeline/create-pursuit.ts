/**
 * createCanonicalPursuit — the ONE server-side writer for a tracked pursuit.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * A pursuit is not `insert into user_pipeline`. It is that insert PLUS the
 * semantics that make the row usable by every downstream surface: the active
 * workspace (coach mode), owner attribution, the canonical SAM UUID, a real
 * response deadline, a next action, decision-time discovery, family truth, the
 * activity record and the background document fetch.
 *
 * `/api/pipeline` POST accumulated all of that over ~15 months of fixes, each
 * one recorded in the comments below. When the anonymous shortlist needed to
 * create a pursuit, copying the insert would have produced a SECOND, poorer
 * contract: a row with no workspace, no owner, no next action, no family and no
 * documents — a second-class pursuit that looks identical in the table and
 * behaves differently everywhere else.
 *
 * So the contract moved here and BOTH callers use it. There is one pursuit
 * implementation.
 *
 * ── AUTH IS NOT IN HERE, DELIBERATELY ──────────────────────────────────────
 * This function takes an ALREADY-VERIFIED identity and an ALREADY-RESOLVED
 * workspace. It performs no authentication and must never be handed an account
 * email that came from a request body. Each route verifies its own caller —
 * `/api/pipeline` with `requireMIAuthSession(request, body.user_email)`, the
 * shortlist claim with `requireMIAuthSession(request)` — and passes the result
 * in. Keeping auth at the edge is what lets a public route reuse the writer
 * without weakening the authenticated one.
 *
 * ── SIDE EFFECTS THE CALLER SCHEDULES ──────────────────────────────────────
 * The document fetch must run AFTER the response, inside a function whose
 * `maxDuration` is long enough to finish (300s). A lib cannot declare that, so
 * a created pursuit returns `postWrite`, and the route schedules it with
 * Next.js `after()`. Any route that calls this MUST do so, and MUST export
 * `maxDuration = 300` — otherwise the fetch is killed mid-PDF-parse and the row
 * is wedged at `docs_status='fetching'` forever (the exact bug after() fixed).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAppActivity } from '@/lib/app/workspace';
import { fetchPursuitDocsAuto } from '@/lib/grants/fetch-grant-docs';
import { isValidSamNoticeId } from '@/lib/sam/utils';
import { isCleanValueEstimate } from '@/lib/pipeline/value-estimate';
import { lookupSamOpportunityForPipeline } from '@/lib/pipeline/sam-opportunity-lookup';
import { computeNextAction } from '@/lib/pipeline/next-action';
import { resolveDiscoveredAt } from '@/lib/pipeline/discovered-at';
import { familyAttachmentForNotice } from '@/lib/sam/solicitation-family';

/** A verified caller writing into a resolved workspace. Never built from a body. */
export interface PursuitWriteContext {
  db: SupabaseClient;
  /** The VERIFIED account email. Becomes user_email / created_by / updated_by. */
  callerEmail: string;
  /** From resolveActiveWorkspace — the CLIENT's workspace in coach mode. */
  workspaceId: string;
  /** True when the caller is a coach acting inside a client workspace. */
  asClient: boolean;
  /** Synthetic client profile address, used for owner attribution in coach mode. */
  clientOwnerEmail: string;
}

/** The fields a caller may supply. Everything else is derived. */
export interface PursuitDraft {
  title: string;
  notice_id?: string;
  source?: string;
  external_url?: string;
  agency?: string;
  value_estimate?: string;
  naics_code?: string;
  set_aside?: string;
  response_deadline?: string;
  stage?: string;
  win_probability?: number;
  priority?: string;
  notes?: string;
  discovered_at?: string;
  next_action?: string;
  next_action_date?: string;
  work_category?: string;
  needs_me_today?: boolean;
  teaming_partners?: string[];
  is_prime?: boolean;
  owner_email?: string;
  collaborators?: string[];
  [k: string]: unknown;
}

export interface PursuitWriteOptions {
  /**
   * SAM notice type from the client payload. `user_pipeline` has no such
   * column, so it is used only to stamp next_action and never written.
   */
  clientNoticeType?: string | null;
  /**
   * Identities to search for the user's EARLIEST view of this notice, in the
   * `user_engagement` sense. Defaults to the caller alone, which is exactly
   * what /api/pipeline has always done.
   *
   * The shortlist claim adds the visitor's `anon:<uuid>`, because that identity
   * is what actually viewed the listing — the same person, before they had an
   * account. Both entries are REAL observations; the earliest wins. Nothing is
   * invented: `resolveDiscoveredAt` can only ever return a time at or before
   * now, so this can under-state discovery but never fabricate it.
   */
  discoveryIdentities?: string[];
}

export interface CreatedPursuit {
  kind: 'created';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pursuit: any;
  family: unknown;
  /** Background document fetch. The route MUST schedule this with after(). */
  postWrite: (() => Promise<void>) | null;
}
export interface DuplicatePursuit {
  kind: 'duplicate';
  /** The row that already exists. Never modified except for family_id backfill. */
  existing: unknown;
}
export interface FailedPursuit {
  kind: 'error';
  error: { message: string; details: string | null; hint: string | null; code: string | null };
}
export type CreatePursuitResult = CreatedPursuit | DuplicatePursuit | FailedPursuit;

const isUuid = (v?: string | null) => !!v && /^[a-f0-9]{32}$/i.test(v.trim());

/**
 * Create the canonical pursuit. Returns a discriminated result rather than an
 * HTTP response, so each route maps it to its own status codes.
 */
export async function createCanonicalPursuit(
  ctx: PursuitWriteContext,
  draft: PursuitDraft,
  options: PursuitWriteOptions = {},
): Promise<CreatePursuitResult> {
  const db = ctx.db;
  const userEmail = ctx.callerEmail.toLowerCase();
  // Work on a copy: the unknown-column retry below deletes keys, and a caller's
  // object should not be mutated out from under it.
  const body: Record<string, unknown> = { ...draft };

  body.user_email = userEmail;
  body.stage = body.stage || 'tracking';
  body.priority = body.priority || 'medium';
  body.source = body.source || 'manual';
  body.is_prime = body.is_prime ?? true;

  body.workspace_id = ctx.workspaceId;
  // Attribute the row to the CLIENT profile in coach mode (so client-scoped
  // surfaces — owner-attributed alerts, pursuit-change digests — key off the
  // client, not the coach). In self mode, owner is the caller.
  body.owner_email = body.owner_email || (ctx.asClient ? ctx.clientOwnerEmail : userEmail);
  body.created_by = userEmail;
  body.updated_by = userEmail;

  // Reject malformed notice_id values. React render keys like
  // 'deadline-140R6026Q0068' have been leaking into this field via email action
  // URLs, which then breaks SAM API lookups. Null-out garbage instead of
  // storing it so downstream code can fall back to title-based search.
  if (body.notice_id && !isValidSamNoticeId(body.notice_id as string)) {
    console.warn(`[pursuit] rejecting malformed notice_id "${body.notice_id}" for "${body.title}"`);
    body.notice_id = undefined;
  }
  // user_pipeline has no notice_type column.
  delete body.notice_type;

  const samMatch = await lookupSamOpportunityForPipeline(db, {
    noticeId: body.notice_id as string | undefined,
    title: body.title as string,
    agency: body.agency as string | undefined,
  });
  // Persist the canonical SAM UUID, not a solicitation number. SAM's file API
  // only matches the 32-char UUID — saving "70203926CGASHED" silently broke
  // every attachment fetch. Prefer the resolved UUID whenever the stored value
  // isn't already one.
  if (samMatch?.noticeId && isUuid(samMatch.noticeId) && !isUuid(body.notice_id as string)) {
    body.notice_id = samMatch.noticeId;
  }
  if (samMatch?.responseDeadline && !body.response_deadline) {
    const d = new Date(samMatch.responseDeadline);
    if (!Number.isNaN(d.getTime())) body.response_deadline = d.toISOString();
  }

  // Reject value_estimate strings that are display labels ("Due in 6 days")
  // instead of dollar amounts, so the Pipeline Value column stays scannable.
  if (body.value_estimate && !isCleanValueEstimate(body.value_estimate as string)) {
    console.warn(`[pursuit] rejecting non-dollar value_estimate "${body.value_estimate}" for "${body.title}"`);
    body.value_estimate = undefined;
  }

  // Backfill response_deadline from the SAM cache when the caller didn't supply
  // one. Several save paths hand us an opportunity whose deadline was empty in
  // their feed, so the pursuit lands with "No deadline" though SAM has the date.
  if (!body.response_deadline && body.notice_id && isValidSamNoticeId(body.notice_id as string)) {
    try {
      const { data: samRow } = await db
        .from('sam_opportunities')
        .select('response_deadline')
        .eq('notice_id', body.notice_id as string)
        .maybeSingle();
      if (samRow?.response_deadline) {
        const d = new Date(samRow.response_deadline);
        if (!Number.isNaN(d.getTime())) body.response_deadline = d.toISOString();
      }
    } catch (e) {
      // Non-fatal — a missing deadline just means the drawer shows "No deadline".
      console.warn('[pursuit] deadline backfill lookup failed:', e);
    }
  }

  // Write-time next_action stamp — the SAME computeNextAction() the AlertsPanel
  // uses, applied to EVERY track path. Measured 2026-07-19: ~63% of tracked rows
  // landed with next_action=NULL and no follow-through button.
  if (!body.next_action) {
    let noticeType: string | null = options.clientNoticeType ?? null;
    if (!noticeType && body.notice_id && isValidSamNoticeId(body.notice_id as string)) {
      try {
        const { data: ntRow } = await db
          .from('sam_opportunities')
          .select('notice_type')
          .eq('notice_id', body.notice_id as string)
          .maybeSingle();
        noticeType = ntRow?.notice_type || null;
      } catch (e) {
        console.warn('[pursuit] next_action type lookup failed:', e);
      }
    }
    const na = computeNextAction(noticeType, (body.set_aside as string) ?? null).key;
    // 'track_only' = no actionable next step → keep NULL.
    if (na && na !== 'track_only') body.next_action = na;
  }

  // Decision-time (#122): freeze WHEN this user first discovered this
  // opportunity. Never fails the save — resolveDiscoveredAt floors to now().
  if (!body.discovered_at) {
    const nowIso = new Date().toISOString();
    const identities = options.discoveryIdentities?.length
      ? options.discoveryIdentities
      : [userEmail];
    let earliest = nowIso;
    for (const identity of identities) {
      const seen = await resolveDiscoveredAt(db, {
        userEmail: identity,
        noticeId: body.notice_id as string | undefined,
        nowIso,
      });
      if (new Date(seen).getTime() < new Date(earliest).getTime()) earliest = seen;
    }
    body.discovered_at = earliest;
  }

  let { data, error } = await db.from('user_pipeline').insert(body).select().single();

  // Unknown-column safety. Drop whatever column the error names and retry, a
  // few times, for BOTH shapes — Postgres 42703 and PostgREST PGRST204.
  // Bounded, and it only ever REMOVES keys, so it cannot widen what is written.
  // Losing a user's pursuit because a field name drifted is worse than ignoring
  // the field.
  for (let attempt = 0; attempt < 5 && error; attempt++) {
    const isMissingColumn = error.code === '42703' || error.code === 'PGRST204';
    if (!isMissingColumn) break;
    const named = /'([^']+)' column|column "([^"]+)"/.exec(error.message || '');
    const col = named?.[1] || named?.[2];
    if (!col || !(col in body)) break;
    console.warn('[pursuit] dropping unknown column and retrying:', col);
    delete body[col];
    ({ data, error } = await db.from('user_pipeline').insert(body).select().single());
  }

  if (error) {
    if (error.code === '23505') {
      // Return the EXISTING row. The caller may need to act on the pursuit (the
      // map's "Generate proposal" opens it by id) and would otherwise be stuck
      // exactly in the common case: an opportunity already tracked.
      // Best-effort: a failed lookup still reports the duplicate.
      let existing: unknown = null;
      try {
        const { data: dup } = await db
          .from('user_pipeline')
          .select('*')
          .eq('user_email', userEmail)
          .eq('notice_id', body.notice_id as string)
          .limit(1)
          .maybeSingle();
        existing = dup ?? null;
        if (dup?.notice_id) {
          const attached = await familyAttachmentForNotice(dup.notice_id, { persist: true, client: db });
          if (attached?.view.family_id && dup.id) {
            await db.from('user_pipeline').update({ family_id: attached.view.family_id }).eq('id', dup.id);
            existing = { ...dup, family_id: attached.view.family_id, family: attached.attachment };
          }
        }
      } catch { /* best-effort — the duplicate verdict is the contract */ }
      return { kind: 'duplicate', existing };
    }
    console.error('[pursuit] Postgres error:', {
      message: error.message, details: error.details, hint: error.hint, code: error.code,
    });
    return {
      kind: 'error',
      error: {
        message: error.message || 'Failed to add to pipeline',
        details: error.details || null,
        hint: error.hint || null,
        code: error.code || null,
      },
    };
  }

  await recordAppActivity({
    workspaceId: ctx.workspaceId,
    userEmail,
    actorEmail: userEmail,
    entityType: 'pipeline',
    entityId: data.id,
    action: 'created',
    summary: `Added ${data.title} to pipeline`,
    metadata: { stage: data.stage, priority: data.priority },
  });

  // Background SAM doc fetch, handed back for the route to schedule with
  // after(). The OLD fire-and-forget approach was killed mid-pdf-parse by
  // Vercel teardown ('DOMMatrix is not defined'), so this must run inside
  // after() in a route with maxDuration = 300 — never called inline.
  const postWrite =
    data.notice_id && data.id
      ? async () => {
          try {
            await fetchPursuitDocsAuto({
              pipelineId: data.id,
              userEmail,
              noticeId: data.notice_id,
              source: data.source,
              title: data.title,
              agency: data.agency,
            });
          } catch (err) {
            console.warn('[pursuit] background doc fetch threw:', err);
            // fetchPursuitDocs sets docs_status='fetching' before the slow work;
            // if it throws before its own terminal write the row is wedged at
            // 'fetching' (infinite spinner). Terminalize it so the drawer shows
            // Retry instead of spinning forever.
            try {
              await db
                .from('user_pipeline')
                .update({ docs_status: 'failed', docs_fetched_at: new Date().toISOString() })
                .eq('id', data.id)
                .in('docs_status', ['fetching', 'pending']);
            } catch { /* best-effort */ }
          }
        }
      : null;

  let family: unknown = null;
  if (data?.notice_id) {
    try {
      const attached = await familyAttachmentForNotice(data.notice_id, { persist: true, client: db });
      if (attached) {
        family = attached.attachment;
        if (attached.view.family_id) {
          const { error: famErr } = await db
            .from('user_pipeline')
            .update({ family_id: attached.view.family_id })
            .eq('id', data.id);
          if (famErr && famErr.code !== '42703' && famErr.code !== 'PGRST204') {
            console.warn('[pursuit] family_id write failed:', famErr.message);
          } else if (!famErr) {
            data = { ...data, family_id: attached.view.family_id };
          }
        }
      }
    } catch (e) {
      console.warn('[pursuit] family attach skipped:', e instanceof Error ? e.message : e);
    }
  }

  return { kind: 'created', pursuit: data, family, postWrite };
}
