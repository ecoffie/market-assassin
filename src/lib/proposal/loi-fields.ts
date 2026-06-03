/**
 * Shared LOI-field types for the Sources Sought / RFI response flow.
 *
 * The whole point (per Eric, 2026-06-03): for Sources Sought you don't need a
 * document upload. The SAM.gov notice TEXT is the input — 90% of SS have no
 * attachments, and when they do it's the same boilerplate instructions. So we
 * extract these structured fields straight from the notice text (which we
 * already cache in sam_opportunities.description, OR the user pastes it) and
 * pre-fill the LOI template instead of exporting blanks.
 */

export interface LoiAgencyAddress {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface LoiFields {
  // Letter header
  solicitationNumber?: string;     // "PANNGB-26-P-0000033323" / "B1502"
  projectTitle?: string;           // "Sources Sought B1502 Renovation"
  agencyName?: string;             // "Department of Defense / Department of the Army"
  agencyAttention?: string;        // contact name to address the letter to
  agencyAddress?: LoiAgencyAddress;

  // Submittal requirements (the part that lives in the notice body)
  submissionDeadline?: string;     // raw as written: "June 5, 2026 2:00 PM CDT"
  submissionMethod?: string;       // "Email: jeremy.hendrick@us.af.mil & stephen.shanks.1@us.af.mil"
  pageLimit?: string;              // "5-page limit" / "10 pages"
  requestedContent?: string[];     // bullet list of what to include in the response
  requiredAttachments?: string[];  // ["Capability statement", "References"]
  capabilityStatementRequested?: 'yes' | 'no' | 'not_stated';

  // Contact + classification
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  naicsCode?: string;              // "236220"
  requiredCertifications?: string[]; // set-asides / certs the notice calls out
}

/**
 * The JSON shape we instruct the model to return. Kept identical to LoiFields
 * so the route can validate without remapping.
 */
export const LOI_FIELDS_KEYS: (keyof LoiFields)[] = [
  'solicitationNumber',
  'projectTitle',
  'agencyName',
  'agencyAttention',
  'agencyAddress',
  'submissionDeadline',
  'submissionMethod',
  'pageLimit',
  'requestedContent',
  'requiredAttachments',
  'capabilityStatementRequested',
  'contactName',
  'contactEmail',
  'contactPhone',
  'naicsCode',
  'requiredCertifications',
];

/** True if extraction found anything worth merging into the template. */
export function loiFieldsHaveContent(f: LoiFields | null | undefined): boolean {
  if (!f) return false;
  return LOI_FIELDS_KEYS.some((k) => {
    const v = f[k];
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.values(v).some(Boolean);
    return String(v).trim().length > 0;
  });
}
