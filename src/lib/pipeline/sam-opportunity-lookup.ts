import type { SupabaseClient } from '@supabase/supabase-js';
import { extractNoticePoc, type NoticePocSet } from '@/lib/proposal/notice-poc';
import { isNoticeUuid, resolveCanonicalSolicitation } from '@/lib/sam/resolve-solicitation';

type PipelineDb = Pick<SupabaseClient, 'from'>;

export interface SamOpportunityRow {
  notice_id: string | null;
  solicitation_number: string | null;
  notice_type: string | null;
  response_deadline: string | null;
  title: string | null;
  department: string | null;
  sub_tier: string | null;
  office: string | null;
  description: string | null;
  attachments: unknown;
  raw_data: unknown;
}

export interface SamOpportunityLookup {
  noticeId: string | null;
  solicitationNumber: string | null;
  noticeType: string | null;
  responseDeadline: string | null;
  description: string | null;
  // Attachment download URLs synced nightly from SAM (resourceLinks). When
  // present we can fetch docs straight from these without a live SAM call.
  attachments: string[];
  // Government POC (CO name/email/phone) from raw_data.pointOfContact. Lets
  // Proposal Assist address an LOI/response to the real contracting officer
  // instead of generic boilerplate (the lowest-scoring eval section).
  poc: NoticePocSet;
}

const SAM_SELECT = 'notice_id, solicitation_number, notice_type, response_deadline, title, department, sub_tier, office, description, attachments, raw_data';

function normalize(value?: string | null): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function agencyMatches(row: SamOpportunityRow, agency?: string | null): boolean {
  const needle = normalize(agency);
  if (!needle) return true;
  return [row.department, row.sub_tier, row.office].some((value) => {
    const candidate = normalize(value);
    if (!candidate) return false;
    return candidate.includes(needle) || needle.includes(candidate);
  });
}

function consistent(rows: SamOpportunityRow[], agency?: string | null): SamOpportunityRow | null {
  const agencyScoped = rows.filter((row) => agencyMatches(row, agency));
  const candidates = agencyScoped.length > 0 ? agencyScoped : rows;
  const typed = candidates.filter((row) => row.notice_type || row.notice_id || row.response_deadline);
  if (typed.length === 0) return null;

  const noticeTypes = new Set(typed.map((row) => row.notice_type || '').filter(Boolean));
  if (noticeTypes.size > 1) return null;
  return typed[0];
}

function toLookup(row: SamOpportunityRow | null): SamOpportunityLookup | null {
  if (!row) return null;
  // attachments is stored as a JSON array of SAM resourceLink URLs. Be
  // defensive — older rows or sync gaps may have null / non-array values.
  const rawLinks = row.attachments;
  const attachments = Array.isArray(rawLinks)
    ? rawLinks.filter((u): u is string => typeof u === 'string' && u.length > 0)
    : [];
  return {
    noticeId: row.notice_id || null,
    solicitationNumber: row.solicitation_number || null,
    noticeType: row.notice_type || null,
    responseDeadline: row.response_deadline || null,
    description: row.description || null,
    attachments,
    poc: extractNoticePoc(row.raw_data),
  };
}

export async function lookupSamOpportunityForPipeline(
  supabase: PipelineDb,
  input: { noticeId?: string | null; title?: string | null; agency?: string | null }
): Promise<SamOpportunityLookup | null> {
  const noticeId = input.noticeId?.trim();
  if (noticeId) {
    // Record UUID stays exact — do not upgrade an older amendment pin to latest.
    const { data: byNoticeId } = await supabase
      .from('sam_opportunities')
      .select(SAM_SELECT)
      .eq('notice_id', noticeId)
      .maybeSingle();
    if (byNoticeId) return toLookup(byNoticeId);

    if (!isNoticeUuid(noticeId)) {
      const canonical = await resolveCanonicalSolicitation(noticeId, { client: supabase });
      if (canonical) {
        const { data: latest } = await supabase
          .from('sam_opportunities')
          .select(SAM_SELECT)
          .eq('notice_id', canonical.notice.notice_id)
          .maybeSingle();
        if (latest) return toLookup(latest);
      }
    }
  }

  const title = input.title?.trim();
  if (!title || title.length < 6) return null;

  const { data: byTitle } = await supabase
    .from('sam_opportunities')
    .select(SAM_SELECT)
    .ilike('title', title)
    .limit(10);

  return toLookup(consistent(byTitle || [], input.agency));
}
