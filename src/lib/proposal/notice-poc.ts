/**
 * Government POC extraction from a SAM notice.
 *
 * The eval showed the "Point of Contact" section scoring worst (65-85): the
 * judge faulted it as generic / not anchored to the notice. The cause is that
 * the draft NEVER saw the government's actual contracting POC — SAM stores it
 * structured in `raw_data.pointOfContact` (CO name, email, phone), but the
 * draft pipeline only ever received the notice BODY text, where the POC is
 * often absent or buried. So the model had no real name to address a Sources
 * Sought / RFI / LOI response to, and fell back to boilerplate.
 *
 * This pulls the real POC so a response can correctly say "Responses directed
 * to: [CO name], [email], [phone]" — grounded, not invented. These values also
 * get added to the fact-guard grounding (v2.ts) so the deterministic guard
 * doesn't strip the gov POC's email/phone as "unverified" — they ARE verified,
 * they came from the notice.
 *
 * (Memory: proposal_offline_eval_harness, ground_in_real_data, proposal_assist_v1)
 */

export interface NoticePoc {
  fullName: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  type: 'primary' | 'secondary' | null;
}

export interface NoticePocSet {
  primary: NoticePoc | null;
  secondary: NoticePoc | null;
  all: NoticePoc[];
}

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

/**
 * Normalize a SAM `raw_data.pointOfContact` array into a typed set. SAM returns
 * an array of `{ type, fullName, title, email, phone, fax }`; `type` is
 * "primary" / "secondary". Defensive against missing/odd shapes (some notices
 * store a single object, some snake_case the key).
 */
export function extractNoticePoc(rawData: unknown): NoticePocSet {
  const empty: NoticePocSet = { primary: null, secondary: null, all: [] };
  if (!rawData || typeof rawData !== 'object') return empty;

  const rd = rawData as Record<string, unknown>;
  const raw = rd.pointOfContact ?? rd.point_of_contact ?? rd.pointofcontact;
  if (!raw) return empty;

  const list = Array.isArray(raw) ? raw : [raw];
  const all: NoticePoc[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const fullName = clean(o.fullName ?? o.full_name ?? o.name);
    const email = clean(o.email);
    const phone = clean(o.phone);
    // A POC with no name AND no email is noise — skip it.
    if (!fullName && !email) continue;
    const typeRaw = clean(o.type)?.toLowerCase();
    all.push({
      fullName,
      title: clean(o.title),
      email,
      phone,
      type: typeRaw === 'primary' ? 'primary' : typeRaw === 'secondary' ? 'secondary' : null,
    });
  }

  const primary = all.find(p => p.type === 'primary') ?? all[0] ?? null;
  const secondary = all.find(p => p.type === 'secondary' && p !== primary) ?? null;
  return { primary, secondary, all };
}

/** True if there's at least one usable government contact. */
export function hasNoticePoc(set: NoticePocSet): boolean {
  return set.all.length > 0;
}

function formatOne(p: NoticePoc): string {
  const bits = [p.fullName, p.title].filter(Boolean).join(', ');
  const contact = [p.phone, p.email].filter(Boolean).join(' · ');
  return [bits, contact].filter(Boolean).join(' — ');
}

/**
 * A prompt block naming the government POC(s) so the draft can address the
 * response to the real contracting officer. Returns '' when there is no POC.
 */
export function formatNoticePocForPrompt(set: NoticePocSet): string {
  if (!hasNoticePoc(set)) return '';
  const lines: string[] = ['### Government point of contact (from the SAM notice — REAL, use verbatim)'];
  if (set.primary) lines.push(`Primary: ${formatOne(set.primary)}`);
  if (set.secondary) lines.push(`Secondary: ${formatOne(set.secondary)}`);
  lines.push(
    'Address the response to the primary POC by name where the section format calls for it ' +
    '(e.g. "Responses are respectfully submitted to [name], [email]"). Use these exact values — ' +
    'do NOT invent or alter the name, email, or phone.',
  );
  return lines.join('\n');
}

/**
 * The raw grounding string (names + emails + phones) to ADD to the fact-guard
 * haystack so the deterministic guard treats the gov POC as verified rather
 * than stripping it as a fabricated contact.
 */
export function noticePocGroundingText(set: NoticePocSet): string {
  return set.all
    .flatMap(p => [p.fullName, p.title, p.email, p.phone])
    .filter(Boolean)
    .join(' ');
}
