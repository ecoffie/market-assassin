/**
 * <title> builder for /opportunity/[slug].
 *
 * SAM titles repeat heavily (DLA alone posts dozens of open "53--GASKET"
 * notices at once), so a title built from `opp.title` alone gave many sitemap
 * URLs the identical <title> and Google treated them as duplicates. The
 * solicitation number tells those notices apart, so it is always kept in full;
 * the SAM title is what gets shortened to fit. With no solicitation number the
 * agency is the distinguishing fact we have.
 *
 * Every part comes from the sam_opportunities row; nothing is invented.
 */

export const MAX_OPPORTUNITY_TITLE = 65;

export interface OpportunityTitleInput {
  title: string;
  solicitationNumber: string | null;
  department: string | null;
  subTier: string | null;
  /** From opportunityStatusLabel(): only 'closed' changes the wording. */
  status: string;
}

function clip(s: string, room: number): string {
  if (s.length <= room) return s;
  return `${s.slice(0, Math.max(1, room - 1)).trimEnd()}…`;
}

/** The distinguishing qualifier: solicitation number, else the buying agency. */
function qualifierOf(o: OpportunityTitleInput): string | null {
  const sol = o.solicitationNumber?.trim();
  if (sol) return sol;
  const agency = (o.subTier || o.department)?.trim();
  return agency || null;
}

export function buildOpportunityTitles(o: OpportunityTitleInput): { title: string; ogTitle: string } {
  const closed = o.status === 'closed';
  const kind = closed ? 'Closed Federal Solicitation' : 'Federal Contract Opportunity';
  const shortKind = closed ? 'Closed' : 'Federal Opportunity';
  const name = o.title.replace(/\s+/g, ' ').trim();
  const q = qualifierOf(o);
  const tag = q ? ` (${q})` : '';

  const ogTitle = `${name}${tag} — ${kind} | Mindy`;
  if (ogTitle.length <= MAX_OPPORTUNITY_TITLE) return { title: ogTitle, ogTitle };

  // Keep the qualifier whole; shorten the SAM title, then the label.
  const MIN_NAME = 12;
  for (const suffix of [`${tag} — ${kind} | Mindy`, `${tag} — ${shortKind} | Mindy`, `${tag} | Mindy`]) {
    const room = MAX_OPPORTUNITY_TITLE - suffix.length;
    if (name.length <= room) return { title: `${name}${suffix}`, ogTitle };
    if (room >= MIN_NAME) return { title: `${clip(name, room)}${suffix}`, ogTitle };
  }
  // A very long qualifier (rare agency names): still lead with the notice title.
  const suffix = `${q && q.length <= 30 ? ` (${q})` : ''} | Mindy`;
  return { title: `${clip(name, MAX_OPPORTUNITY_TITLE - suffix.length)}${suffix}`, ogTitle };
}
