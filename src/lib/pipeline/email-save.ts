/**
 * Email "add to pipeline": parsing, the read-only confirmation model, and the ONE write path.
 *
 * Contract (2026-10-06, the link-scanner defect — see email-save-token.ts):
 *   - GET / HEAD / OPTIONS on the email link never write. They only lead to the confirmation page.
 *   - The confirmation page is READ-ONLY (buildEmailSaveConfirmation): it verifies the email link,
 *     checks "already tracking", and mints a signed, expiring, action-bound form token.
 *   - Only an explicit POST of that form calls createConfirmedEmailSave(), which records the user's
 *     confirmation (pipeline_save_confirmations) separately from link delivery/open and is
 *     idempotent on the form's idempotency key.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyEmailToken } from '@/lib/api-auth';
import { isValidSamNoticeId } from '@/lib/sam/utils';
import { sanitizeValueEstimate } from '@/lib/pipeline/value-estimate';
import { lookupSamOpportunityForPipeline } from '@/lib/pipeline/sam-opportunity-lookup';
import { resolveDiscoveredAt } from '@/lib/pipeline/discovered-at';
import { mintSaveAction, opportunityKeyFor, verifySaveAction, SAVE_ACTION_TTL_SECONDS, type SaveActionClaims } from './email-save-token';

export const SAVE_STAGES = ['tracking', 'pursuing', 'bidding', 'submitted'] as const;
export type SaveStage = (typeof SAVE_STAGES)[number];

export interface EmailSaveFields {
  email: string;
  title: string;
  noticeId: string | null;
  stage: SaveStage;
  agency: string | null;
  value: string | null;
  deadline: string | null;
  naics: string | null;
  setAside: string | null;
  source: string;
  externalUrl: string | null;
}

type ParamReader = { get(name: string): string | null | File };
const str = (r: ParamReader, ...names: string[]): string | null => {
  for (const n of names) {
    const v = r.get(n);
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return null;
};

/** Read the save fields from the email link query string or the confirmation form. */
export function parseEmailSaveFields(r: ParamReader): EmailSaveFields | null {
  const email = str(r, 'email');
  const title = str(r, 'title');
  if (!email || !title) return null;
  const stageRaw = str(r, 'stage') || 'tracking';
  return {
    email: email.trim().toLowerCase(),
    title,
    noticeId: str(r, 'notice_id', 'noticeId'),
    stage: (SAVE_STAGES as readonly string[]).includes(stageRaw) ? (stageRaw as SaveStage) : 'tracking',
    agency: str(r, 'agency'),
    value: str(r, 'value'),
    deadline: str(r, 'deadline'),
    naics: str(r, 'naics'),
    setAside: str(r, 'setAside', 'set_aside'),
    source: str(r, 'source') || 'email_action',
    externalUrl: str(r, 'url', 'samLink'),
  };
}

const safeDecode = (v: string | null) => {
  if (v == null) return null;
  try { return decodeURIComponent(v); } catch { return v; }
};

/** Same lookup the old GET used: by notice id when present, else by title. Read-only. */
export async function findExistingPipelineRow(
  sb: SupabaseClient,
  f: Pick<EmailSaveFields, 'email' | 'noticeId' | 'title'>,
): Promise<{ id: string; stage: string } | null> {
  let q = sb.from('user_pipeline').select('id, stage').eq('user_email', f.email);
  q = f.noticeId ? q.eq('notice_id', f.noticeId) : q.eq('title', f.title);
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw new Error(`pipeline lookup failed: ${error.message}`);
  return (data as { id: string; stage: string } | null) ?? null;
}

export type EmailSaveConfirmation =
  | { state: 'invalid'; reason: 'missing_params' | 'link_invalid' | 'link_expired' }
  | { state: 'already_tracking'; fields: EmailSaveFields; stage: string }
  | { state: 'ready'; fields: EmailSaveFields; linkIssuedAt: number; action: SaveActionClaims & { sig: string } };

/**
 * The confirmation page's model. READ-ONLY by contract: a scanner that follows the email link
 * renders this page, so nothing here may insert, update, upsert or delete.
 */
export async function buildEmailSaveConfirmation(
  sb: SupabaseClient,
  params: ParamReader,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<EmailSaveConfirmation> {
  const fields = parseEmailSaveFields(params);
  if (!fields) return { state: 'invalid', reason: 'missing_params' };
  const token = str(params, 'token');
  const ts = str(params, 'ts');
  if (!token || !ts) return { state: 'invalid', reason: 'link_invalid' };
  const auth = verifyEmailToken(fields.email, token, ts);
  if (!auth.authenticated) {
    return { state: 'invalid', reason: auth.error === 'Link expired' ? 'link_expired' : 'link_invalid' };
  }
  const existing = await findExistingPipelineRow(sb, fields);
  if (existing) return { state: 'already_tracking', fields, stage: existing.stage };
  return {
    state: 'ready',
    fields,
    linkIssuedAt: parseInt(ts, 10),
    action: mintSaveAction(fields.email, opportunityKeyFor(fields.noticeId, fields.title), nowSeconds),
  };
}

export type ConfirmedSaveResult =
  | { outcome: 'created'; pipelineId: string; noticeId: string | null; row: Record<string, unknown> }
  | { outcome: 'already_tracking'; pipelineId: string | null; stage: string | null }
  | { outcome: 'replayed'; pipelineId: string | null }
  | { outcome: 'rejected'; reason: 'malformed' | 'expired' | 'bad_signature' | 'missing_params' }
  | { outcome: 'error'; message: string };

/**
 * The ONLY write path for an email save. Called solely from the confirmation form's POST.
 *
 * Idempotency, in order:
 *   1. the form's idempotency key is claimed in pipeline_save_confirmations (PRIMARY KEY);
 *      a second submission of the same form finds it and replays — no second pipeline row;
 *   2. an existing pipeline row for the same opportunity → already tracking;
 *   3. the user_pipeline (user_email, notice_id) unique index → a concurrent insert resolves
 *      to already tracking (23505), never a duplicate.
 */
export async function createConfirmedEmailSave(
  sb: SupabaseClient,
  form: ParamReader,
  ctx: { userAgent: string | null; nowMs?: number },
): Promise<ConfirmedSaveResult> {
  const fields = parseEmailSaveFields(form);
  if (!fields) return { outcome: 'rejected', reason: 'missing_params' };
  const claims: SaveActionClaims = {
    email: fields.email,
    opportunityKey: opportunityKeyFor(fields.noticeId, fields.title),
    idempotencyKey: str(form, 'idempotency_key') || '',
    exp: parseInt(str(form, 'exp') || '', 10),
  };
  const check = verifySaveAction(claims, str(form, 'sig') || '', Math.floor((ctx.nowMs ?? Date.now()) / 1000));
  if (!check.ok) return { outcome: 'rejected', reason: check.reason };

  const nowIso = new Date(ctx.nowMs ?? Date.now()).toISOString();
  const linkIssued = parseInt(str(form, 'link_ts') || '', 10);

  // 1) Claim the idempotency key. A duplicate key = this exact form was already submitted.
  const { error: claimErr } = await sb.from('pipeline_save_confirmations').insert({
    idempotency_key: claims.idempotencyKey,
    user_email: fields.email,
    opportunity_key: claims.opportunityKey,
    notice_id: fields.noticeId,
    source: fields.source,
    outcome: 'pending',
    confirmed_by_user: true,
    link_issued_at: Number.isFinite(linkIssued) ? new Date(linkIssued * 1000).toISOString() : null,
    form_rendered_at: new Date((claims.exp - SAVE_ACTION_TTL_SECONDS) * 1000).toISOString(),
    confirmed_at: nowIso,
    user_agent: ctx.userAgent,
  });
  if (claimErr) {
    if (claimErr.code === '23505') {
      const { data: prior, error: priorErr } = await sb.from('pipeline_save_confirmations')
        .select('pipeline_id').eq('idempotency_key', claims.idempotencyKey).maybeSingle();
      if (priorErr) return { outcome: 'error', message: `confirmation lookup failed: ${priorErr.message}` };
      return { outcome: 'replayed', pipelineId: (prior as { pipeline_id: string | null } | null)?.pipeline_id ?? null };
    }
    // Fail CLOSED: without the confirmation record there is no idempotency and no evidence the
    // user confirmed, so no pipeline row is written.
    return { outcome: 'error', message: `confirmation record failed: ${claimErr.message}` };
  }

  const finish = async (outcome: 'created' | 'already_tracking' | 'failed', pipelineId: string | null) => {
    const { error } = await sb.from('pipeline_save_confirmations')
      .update({ outcome, pipeline_id: pipelineId }).eq('idempotency_key', claims.idempotencyKey);
    if (error) console.error('[email-save] confirmation outcome update failed:', error.message);
  };

  try {
    // 2) Already tracking?
    const existing = await findExistingPipelineRow(sb, fields);
    if (existing) {
      await finish('already_tracking', existing.id);
      return { outcome: 'already_tracking', pipelineId: existing.id, stage: existing.stage };
    }

    // 3) Insert — the same normalization the old GET path applied.
    let noticeId = fields.noticeId && isValidSamNoticeId(fields.noticeId) ? fields.noticeId : null;
    if (fields.noticeId && !noticeId) console.warn(`[email-save] dropping malformed notice_id "${fields.noticeId}"`);
    const title = safeDecode(fields.title) as string;
    const agency = safeDecode(fields.agency);
    const samMatch = await lookupSamOpportunityForPipeline(sb, { noticeId, title, agency });
    const isUuid = (v?: string | null) => !!v && /^[a-f0-9]{32}$/i.test(v.trim());
    if (samMatch?.noticeId && isUuid(samMatch.noticeId) && !isUuid(noticeId)) noticeId = samMatch.noticeId;

    const discovered_at = await resolveDiscoveredAt(sb, { userEmail: fields.email, noticeId, nowIso });
    const entry = {
      user_email: fields.email,
      notice_id: noticeId,
      discovered_at,
      title,
      agency,
      value_estimate: sanitizeValueEstimate(safeDecode(fields.value)),
      response_deadline: fields.deadline || samMatch?.responseDeadline || null,
      naics_code: fields.naics,
      set_aside: safeDecode(fields.setAside),
      stage: fields.stage,
      source: fields.source,
      external_url: safeDecode(fields.externalUrl),
      priority: 'medium',
      created_at: nowIso,
      updated_at: nowIso,
    };
    const { data: row, error: insErr } = await sb.from('user_pipeline').insert(entry).select().single();
    if (insErr) {
      if (insErr.code === '23505') {
        const again = await findExistingPipelineRow(sb, { ...fields, noticeId });
        await finish('already_tracking', again?.id ?? null);
        return { outcome: 'already_tracking', pipelineId: again?.id ?? null, stage: again?.stage ?? null };
      }
      await finish('failed', null);
      return { outcome: 'error', message: `pipeline insert failed: ${insErr.message}` };
    }
    const created = row as { id: string; notice_id: string | null } & Record<string, unknown>;
    await finish('created', created.id);
    return { outcome: 'created', pipelineId: created.id, noticeId: created.notice_id, row: created };
  } catch (e) {
    await finish('failed', null);
    return { outcome: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
