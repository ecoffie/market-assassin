/**
 * Deep-link params for /app — the context the Opportunity Map (and anything else) carries
 * on a link INTO a panel, parsed in ONE place so page.tsx owns URL handling and panels only
 * see typed props.
 *
 * Links the map emits today:
 *   /app?panel=proposals&pursuit_id=<id>&action=compliance|review|export|submit
 *   /app?panel=contacts&agency=<agency name>
 *   /app?panel=vault&section=documents
 *   /app?panel=settings&section=billing|security|notifications|team
 *
 * Contract: every value is validated against a closed set (or a strict shape). An unknown or
 * malformed value is DROPPED, never passed through — the panel then opens on its normal
 * default. Params are only read for the panel they belong to, so `?agency=` on a Proposals
 * link can never leak into a different meaning.
 */

export const PROPOSAL_ACTIONS = ['compliance', 'review', 'export', 'submit'] as const;
export type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];

export const VAULT_SECTIONS = ['identity', 'past_performance', 'capabilities', 'team', 'documents', 'generated'] as const;
export type VaultDeepLinkSection = (typeof VAULT_SECTIONS)[number];

export const SETTINGS_SECTIONS = ['billing', 'credits', 'security', 'notifications', 'team'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export interface AppDeepLinkContext {
  pursuit_id?: string;
  proposal_action?: ProposalAction;
  agency?: string;
  section?: VaultDeepLinkSection | SettingsSection;
}

interface ParamReader {
  get(key: string): string | null;
}

const PURSUIT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_AGENCY_LEN = 200;

function oneOf<T extends string>(allowed: readonly T[], raw: string | null): T | undefined {
  const v = (raw || '').trim().toLowerCase();
  return (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function parsePursuitId(raw: string | null): string | undefined {
  const v = (raw || '').trim();
  return PURSUIT_ID_RE.test(v) ? v : undefined;
}

export function parseProposalAction(raw: string | null): ProposalAction | undefined {
  return oneOf(PROPOSAL_ACTIONS, raw);
}

export function parseVaultSection(raw: string | null): VaultDeepLinkSection | undefined {
  return oneOf(VAULT_SECTIONS, raw);
}

export function parseSettingsSection(raw: string | null): SettingsSection | undefined {
  return oneOf(SETTINGS_SECTIONS, raw);
}

/** Agency NAME (free text). Collapses whitespace, strips control characters, caps length. */
export function parseAgency(raw: string | null): string | undefined {
  const v = (raw || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!v || v.length > MAX_AGENCY_LEN) return undefined;
  return v;
}

/**
 * The panel-specific context carried by a deep link. Returns only the keys that are valid
 * for `panel`; an empty object means "open the panel on its default".
 */
export function parseAppDeepLink(panel: string | null, params: ParamReader): AppDeepLinkContext {
  const out: AppDeepLinkContext = {};
  switch (panel) {
    case 'proposals': {
      const pursuitId = parsePursuitId(params.get('pursuit_id'));
      if (pursuitId) out.pursuit_id = pursuitId;
      const action = parseProposalAction(params.get('action'));
      if (action) out.proposal_action = action;
      break;
    }
    case 'contacts': {
      const agency = parseAgency(params.get('agency'));
      if (agency) out.agency = agency;
      break;
    }
    case 'vault': {
      const section = parseVaultSection(params.get('section'));
      if (section) out.section = section;
      break;
    }
    case 'settings': {
      const section = parseSettingsSection(params.get('section'));
      if (section) out.section = section;
      break;
    }
    default:
      break;
  }
  return out;
}

/** Human label + DOM anchor for each Proposals action (the panel is one long page). */
export const PROPOSAL_ACTION_TARGETS: Record<ProposalAction, { label: string; anchorId: string }> = {
  compliance: { label: 'Compliance matrix', anchorId: 'proposal-compliance-section' },
  review: { label: 'Independent compliance check', anchorId: 'proposal-referee-section' },
  export: { label: 'Word export', anchorId: 'proposal-export-section' },
  // There is no in-app "submit" step — submission happens on the agency's portal. The closest
  // existing view is the final review checklist ("Before submitting"), so the link lands there.
  submit: { label: 'Final checklist before submitting', anchorId: 'proposal-final-review-section' },
};

export const SETTINGS_SECTION_ANCHORS: Record<SettingsSection, string> = {
  billing: 'settings-billing',
  credits: 'settings-credits',
  security: 'settings-security',
  notifications: 'settings-notifications',
  team: 'settings-team',
};
