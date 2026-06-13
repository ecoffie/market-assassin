/**
 * Shared helpers for the proposal-eval harness: notice-body resolution +
 * vault loading for the fact-checker. Kept in one place so pick / run / score
 * agree on what "the source text" and "the known facts" are.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isDescriptionLink, fetchNoticeDescription } from '../../src/lib/sam/notice-description';

// Lazy singleton — ESM hoists imports above a caller's dotenv.config(), so
// reading env at module-init time can race. Defer until first use.
let _sb: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}
const SAM_API_KEY = () => process.env.SAM_API_KEY || '';

export async function loadNoticeBody(noticeId: string): Promise<{ title: string; body: string }> {
  const { data: row } = await db()
    .from('sam_opportunities')
    .select('notice_id, title, description, sow_text, raw_data')
    .eq('notice_id', noticeId)
    .maybeSingle();
  if (!row) return { title: '', body: '' };
  const sow = (row.sow_text || '').trim();
  let desc = (row.description || '').trim();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawDesc = ((row.raw_data as any)?.description || '').trim();
  const link =
    (desc && isDescriptionLink(desc) && desc) ||
    (rawDesc && isDescriptionLink(rawDesc) && rawDesc) ||
    '';
  if (desc && isDescriptionLink(desc)) desc = '';
  if (!desc && rawDesc && !isDescriptionLink(rawDesc)) desc = rawDesc;
  if (!desc && link && SAM_API_KEY()) desc = (await fetchNoticeDescription(link, SAM_API_KEY()).catch(() => '')) || '';
  if (!sow && !desc && SAM_API_KEY()) desc = (await fetchNoticeDescription(row.notice_id, SAM_API_KEY()).catch(() => '')) || '';
  const body = [row.title, sow, desc].filter(Boolean).join('\n\n').trim();
  return { title: row.title || '', body };
}

/**
 * Everything we KNOW to be true about the bidder, as one searchable string.
 * The fact-checker uses this (+ the notice body) to decide whether a number /
 * name / contract in a draft is grounded or invented.
 */
export async function loadKnownFacts(email: string): Promise<string> {
  const [id, pp, caps, team] = await Promise.all([
    db().from('user_identity_profile').select('*').eq('user_email', email).maybeSingle().then(r => r.data, () => null),
    db().from('user_past_performance').select('*').eq('user_email', email).is('archived_at', null).then(r => r.data, () => []),
    db().from('user_capabilities').select('*').eq('user_email', email).then(r => r.data, () => []),
    db().from('user_team_members').select('*').eq('user_email', email).then(r => r.data, () => []),
  ]);
  const parts: string[] = [];
  if (id) parts.push(JSON.stringify(id));
  for (const r of (pp || [])) parts.push(JSON.stringify(r));
  for (const r of (caps || [])) parts.push(JSON.stringify(r));
  for (const r of (team || [])) parts.push(JSON.stringify(r));
  return parts.join('\n');
}

export const LOI_SECTIONS = ['company_overview', 'cap_past_performance', 'capabilities', 'differentiators', 'poc'] as const;
export const RFP_SECTIONS = ['exec_summary', 'technical', 'management', 'past_performance', 'pricing'] as const;
