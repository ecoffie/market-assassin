/**
 * The ONLY route that saves an opportunity from an email: the confirmation page's button POST.
 *
 * GET / HEAD / OPTIONS here never write (a scanner probing this URL gets 405 / 204). The POST
 * must carry the confirmation form's signed, expiring, action-bound token; it is idempotent on the
 * form's idempotency key (see createConfirmedEmailSave). Responses are 303 redirects so the browser
 * lands on a GET result page and a refresh cannot resubmit.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createConfirmedEmailSave } from '@/lib/pipeline/email-save';
import { fetchPursuitDocsAuto } from '@/lib/grants/fetch-grant-docs';

export const dynamic = 'force-dynamic';

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function seeOther(request: NextRequest, path: string, params: Record<string, string> = {}) {
  const url = new URL(path, request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url, 303);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return seeOther(request, '/pipeline/error', { reason: 'missing_params' });
  }
  const title = (form.get('title') as string | null) || 'Opportunity';
  const stage = (form.get('stage') as string | null) || 'tracking';
  const email = ((form.get('email') as string | null) || '').trim().toLowerCase();
  const source = (form.get('source') as string | null) || 'email_action';

  const sb = serviceClient();
  const result = await createConfirmedEmailSave(sb, form, { userAgent: request.headers.get('user-agent') });

  switch (result.outcome) {
    case 'created': {
      const row = result.row as { id: string; notice_id: string | null; source?: string; title?: string; agency?: string | null };
      if (row.notice_id) {
        after(async () => {
          try {
            await fetchPursuitDocsAuto({
              pipelineId: row.id, userEmail: email, noticeId: row.notice_id as string,
              source: row.source ?? source, title: row.title ?? title, agency: row.agency ?? null,
            });
          } catch (err) {
            console.warn('[add-to-pipeline confirm] background doc fetch threw:', err);
          }
        });
      }
      return seeOther(request, '/pipeline/added', { title, stage });
    }
    case 'replayed':
      return seeOther(request, '/pipeline/added', { title, stage });
    case 'already_tracking':
      return seeOther(request, '/pipeline/already-tracking', { title, stage: result.stage ?? stage });
    case 'rejected':
      return seeOther(request, '/pipeline/error', { reason: result.reason === 'expired' ? 'link_expired' : 'unauthorized' });
    default:
      console.error('[add-to-pipeline confirm] save failed:', result.message);
      return seeOther(request, '/pipeline/error', { reason: 'db_error' });
  }
}

const notAllowed = () =>
  new NextResponse('Use the confirmation button to save.', { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });

export async function GET() { return notAllowed(); }
export async function HEAD() { return notAllowed(); }
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { Allow: 'POST' } });
}
