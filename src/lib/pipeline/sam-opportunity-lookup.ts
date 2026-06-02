type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data: SamOpportunityRow | null; error?: unknown }>;
      };
      ilike: (column: string, value: string) => {
        limit: (count: number) => Promise<{ data: SamOpportunityRow[] | null; error?: unknown }>;
      };
    };
  };
};

export interface SamOpportunityRow {
  notice_id: string | null;
  solicitation_number: string | null;
  notice_type: string | null;
  response_deadline: string | null;
  title: string | null;
  department: string | null;
  sub_tier: string | null;
  office: string | null;
}

export interface SamOpportunityLookup {
  noticeId: string | null;
  noticeType: string | null;
  responseDeadline: string | null;
}

const SAM_SELECT = 'notice_id, solicitation_number, notice_type, response_deadline, title, department, sub_tier, office';

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
  return {
    noticeId: row.notice_id || null,
    noticeType: row.notice_type || null,
    responseDeadline: row.response_deadline || null,
  };
}

export async function lookupSamOpportunityForPipeline(
  supabase: SupabaseLike,
  input: { noticeId?: string | null; title?: string | null; agency?: string | null }
): Promise<SamOpportunityLookup | null> {
  const noticeId = input.noticeId?.trim();
  if (noticeId) {
    const { data: byNoticeId } = await supabase
      .from('sam_opportunities')
      .select(SAM_SELECT)
      .eq('notice_id', noticeId)
      .maybeSingle();
    if (byNoticeId) return toLookup(byNoticeId);

    const { data: bySolicitation } = await supabase
      .from('sam_opportunities')
      .select(SAM_SELECT)
      .ilike('solicitation_number', noticeId)
      .limit(10);
    const solicitationMatch = consistent(bySolicitation || [], input.agency);
    if (solicitationMatch) return toLookup(solicitationMatch);
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
