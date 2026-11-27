/**
 * Ask Mindy write actions (BETA). The client POSTs here ONLY after the user confirms an action Mindy proposed.
 *
 * Body: { email, action_id, name, args, confirmed: true }
 *   - Same MI session check as today's buttons (requireMIAuthSession), same coach-mode workspace (resolveActiveWorkspace).
 *   - confirmed !== true → 400 confirmation_required. The server never performs an unconfirmed write.
 *   - The work is done by the SAME libs as the buttons (src/lib/mindy-actions/write-actions.ts).
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getAppSupabase, recordAppActivity, resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';
import { createSavedSearch, updateSavedSearch } from '@/lib/saved-searches';
import { createCanonicalPursuit } from '@/lib/pipeline/create-pursuit';
import { removeOwnedPursuit } from '@/lib/pipeline/remove-pursuit';
import { executeWriteAction, parseWriteAction, type WriteActionDeps } from '@/lib/mindy-actions/write-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A created pursuit schedules the same background document fetch as /api/pipeline POST (after()).
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body?.email || '').toLowerCase().trim();
  const actionId = String(body?.action_id || '').slice(0, 128);
  const name = String(body?.name || '');
  if (!email) return NextResponse.json({ ok: false, error_code: 'email_required', message: 'email is required' }, { status: 400 });
  if (!actionId) return NextResponse.json({ ok: false, error_code: 'action_id_required', message: 'action_id is required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  if (body?.confirmed !== true) {
    return NextResponse.json(
      { ok: false, action_id: actionId, name, error_code: 'confirmation_required', message: 'Confirm this action before Mindy saves anything.' },
      { status: 400 },
    );
  }

  const parsed = parseWriteAction(name, body?.args);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, action_id: actionId, name, error_code: 'invalid_action', message: parsed.error }, { status: 400 });
  }

  const { workspaceId, asClient } = await resolveActiveWorkspace(email, request);
  const db = getAppSupabase();
  const deps: WriteActionDeps = {
    db,
    createSavedSearch: createSavedSearch as unknown as WriteActionDeps['createSavedSearch'],
    updateSavedSearch: updateSavedSearch as unknown as WriteActionDeps['updateSavedSearch'],
    createCanonicalPursuit,
    removeOwnedPursuit,
    schedule: (work) => after(work),
    recordActivity: (e) => recordAppActivity({
      workspaceId, userEmail: email, actorEmail: email, entityType: 'pipeline', entityId: e.entityId, action: e.action, summary: e.summary,
      metadata: { via: 'ask_mindy', action_id: actionId },
    }).then(() => undefined),
  };

  try {
    const result = await executeWriteAction(parsed.action, actionId, {
      email, workspaceId, asClient, clientOwnerEmail: clientNotificationEmail(workspaceId), origin: '',
    }, deps);
    const status = result.ok ? 200
      : result.error_code === 'not_found' ? 404
      : result.error_code === 'scheduler_unavailable' || result.error_code === 'lookup_failed' || result.error_code === 'write_failed' ? 503
      : 400;
    return NextResponse.json(result, { status });
  } catch (e) {
    console.error('[mindy-actions] write failed', parsed.action.name, e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, action_id: actionId, name: parsed.action.name, error_code: 'write_failed', message: 'Something went wrong. Nothing was confirmed as saved.' }, { status: 500 });
  }
}
