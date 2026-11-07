/**
 * Pure mapping for things a user saved on the Opportunity Map, so /app can show them.
 *
 * Every map heart / "Track this recompete" / "Add to targets" / "Add to CRM" writes ONE row to
 * `user_saved_opportunities` via POST /api/opportunities/save. The row's KIND is not a column:
 * the map tags it with `source` (company_map / buyer_map / recompete_map) and, for those three,
 * `opportunity_data.entityType`. An open-opportunity heart sends no source (stored as 'manual')
 * and keeps the SAM notice id in `notice_id`. Email links save with daily_alert etc.
 *
 * Ids, as the map stores them (src/app/opportunity-map/route.ts saveReq / toggle*Fav):
 *   opportunity → notice_id = SAM notice id (fc-… = a forecast)
 *   recompete   → notice_id = recompete_opportunities.contract_id
 *   company     → notice_id = UEI (also opportunity_data.uei)
 *   buyer       → notice_id = federal_contacts id
 *
 * "Open on the map" links are RECORD links built by src/lib/maps/map-links.ts — id only.
 */
import { cleanRecompetePiid, RECOMPETE_PURSUIT_SOURCE, recompetePursuitTitle } from '@/lib/recompete/pursuit-key';
import {
  mapLinkForBuyer,
  mapLinkForCompany,
  mapLinkForOpportunity,
  mapLinkForRecompete,
  mapLinkForSavedSearch,
} from '@/lib/maps/map-links';

export type SavedMapKind = 'opportunity' | 'forecast' | 'recompete' | 'company' | 'buyer';

export const SAVED_KIND_LABEL: Record<SavedMapKind, string> = {
  opportunity: 'Opportunity',
  forecast: 'Forecast',
  recompete: 'Recompete',
  company: 'Company',
  buyer: 'Buyer',
};

/** The subset of a GET /api/opportunities/save row this module reads. */
export interface SavedOppRow {
  id?: string | null;
  notice_id?: string | null;
  title?: string | null;
  agency?: string | null;
  source?: string | null;
  response_deadline?: string | null;
  created_at?: string | null;
  opportunity_data?: Record<string, unknown> | null;
}

export interface SavedMapItem {
  /** The record id the row was saved under (notice_id) — also the DELETE key. */
  recordId: string;
  kind: SavedMapKind;
  kindLabel: string;
  title: string;
  agency: string | null;
  deadline: string | null;
  savedAt: string | null;
  source: string | null;
  mapHref: string | null;
  /** Only opportunity-like rows can become a pursuit (companies and buyers are not bids). */
  canStartPursuit: boolean;
  /**
   * The id a pursuit is keyed on. Opportunities: the notice id. Recompetes: the PIID
   * (opportunity_data.solicitationNumber), NOT the contract_id the favorite is saved under. The
   * pipeline writer drops ids that fail isValidSamNoticeId, and a CONT_AWD_… contract_id fails it,
   * which would leave the pursuit with no notice_id and no duplicate protection. Same key the
   * map's "Track this recompete" uses.
   */
  pursuitNoticeId: string | null;
}

const cleanPiid = cleanRecompetePiid;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function savedRowKind(row: SavedOppRow): SavedMapKind {
  const source = str(row.source).toLowerCase();
  const entity = str(row.opportunity_data?.entityType).toLowerCase();
  if (source === 'company_map' || entity === 'company') return 'company';
  if (source === 'buyer_map' || entity === 'buyer') return 'buyer';
  if (source === 'recompete_map' || entity === 'recompete') return 'recompete';
  if (/^fc-/i.test(str(row.notice_id))) return 'forecast';
  return 'opportunity';
}

export function savedRowMapLink(row: SavedOppRow, kind: SavedMapKind = savedRowKind(row)): string | null {
  const id = str(row.notice_id);
  switch (kind) {
    case 'company':
      return mapLinkForCompany(str(row.opportunity_data?.uei) || id);
    case 'buyer':
      return mapLinkForBuyer(id);
    case 'recompete':
      return mapLinkForRecompete(id);
    default:
      // mapLinkForOpportunity routes an fc- id to ?forecast= itself.
      return mapLinkForOpportunity(id);
  }
}

function fallbackTitle(kind: SavedMapKind, id: string): string {
  if (kind === 'company') return id ? `Company (UEI ${id})` : 'Company';
  if (kind === 'buyer') return 'Government buyer';
  if (kind === 'recompete') return id ? `Contract ${id}` : 'Expiring contract';
  return id ? `Notice ${id}` : 'Saved opportunity';
}

export function toSavedMapItem(row: SavedOppRow): SavedMapItem | null {
  const recordId = str(row.notice_id);
  if (!recordId) return null;
  const kind = savedRowKind(row);
  const title = str(row.title) || str(row.opportunity_data?.title);
  // The save route writes 'Unknown Opportunity' when no snapshot was sent — not a real title.
  const usable = title && title !== 'Unknown Opportunity' ? title : '';
  const agency = str(row.agency) || str(row.opportunity_data?.department) || str(row.opportunity_data?.agency);
  return {
    recordId,
    kind,
    kindLabel: SAVED_KIND_LABEL[kind],
    title: usable || fallbackTitle(kind, recordId),
    agency: agency || null,
    deadline: str(row.response_deadline) || null,
    savedAt: str(row.created_at) || null,
    source: str(row.source) || null,
    mapHref: savedRowMapLink(row, kind),
    ...(() => {
      const pursuitNoticeId = kind === 'recompete' ? cleanPiid(row.opportunity_data?.solicitationNumber) || null : recordId;
      return {
        pursuitNoticeId,
        canStartPursuit: (kind === 'opportunity' || kind === 'forecast' || kind === 'recompete') && !!pursuitNoticeId,
      };
    })(),
  };
}

export function toSavedMapItems(rows: unknown, kinds?: readonly SavedMapKind[]): SavedMapItem[] {
  if (!Array.isArray(rows)) return [];
  const out: SavedMapItem[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const item = toSavedMapItem(r as SavedOppRow);
    if (!item) continue;
    if (kinds && !kinds.includes(item.kind)) continue;
    out.push(item);
  }
  return out;
}

/** Body for POST /api/pipeline — the same shape the map's saveReq sends for a pursuit. */
export function pursuitBodyFor(item: SavedMapItem, email: string): Record<string, unknown> {
  return {
    user_email: email,
    // Recompetes: same title and source as the map's "Track this recompete" (pursuit-key.ts).
    title: item.kind === 'recompete' && item.pursuitNoticeId ? recompetePursuitTitle(item.title, item.pursuitNoticeId) : item.title,
    notice_id: item.pursuitNoticeId || item.recordId,
    agency: item.agency || undefined,
    // A contract's expiry is not a bid deadline: never send it as response_deadline.
    response_deadline: item.kind === 'recompete' ? undefined : item.deadline || undefined,
    source: item.kind === 'recompete' ? RECOMPETE_PURSUIT_SOURCE : 'opportunity_map',
  };
}

// ── Saved searches ──────────────────────────────────────────────────────────

const MODE_LABEL: Record<string, string> = {
  open: 'Open opportunities',
  recompete: 'Recompetes',
  forecast: 'Forecasts',
  companies: 'Companies',
  buyers: 'Buyers',
  dla: 'DLA',
};

export function savedSearchModeLabel(mode: unknown): string | null {
  const m = str(mode).toLowerCase();
  return m ? MODE_LABEL[m] || m : null;
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean);
  const s = str(v);
  return s ? s.split(',').map((x) => x.trim()).filter(Boolean) : [];
}

function listPart(label: string, v: unknown, max = 3): string | null {
  const xs = asList(v);
  if (!xs.length) return null;
  const shown = xs.slice(0, max).join(', ');
  return `${label} ${shown}${xs.length > max ? ` +${xs.length - max} more` : ''}`;
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const isOn = (v: unknown) => v === true || TRUTHY.has(str(v).toLowerCase());

/**
 * A short human summary of a saved search's stored filters. Only keys the map's filter parser
 * reads (parseMapFilters) are described; anything else is ignored rather than guessed at.
 * Returns '' when no filter is set (the search is the whole map for its mode).
 */
export function summarizeSavedSearchFilters(filters: unknown): string {
  if (!filters || typeof filters !== 'object') return '';
  const f = filters as Record<string, unknown>;
  const parts: string[] = [];
  const kw = str(f.q) || str(f.search);
  if (kw) parts.push(`"${kw}"`);
  const naics = listPart('NAICS', f.naics);
  if (naics) parts.push(naics);
  const psc = listPart('PSC', f.psc);
  if (psc) parts.push(psc);
  const agency = str(f.agency) || str(f.subAgency);
  if (agency) parts.push(agency);
  const state = listPart('in', f.state, 4);
  if (state) parts.push(state);
  const setAside = listPart('Set-aside:', f.setAside, 2);
  if (setAside) parts.push(setAside);
  if (isOn(f.fullOpen)) parts.push('Full & open');
  const nt = listPart('Type:', f.noticeType, 2);
  if (nt) parts.push(nt);
  const closing = Number(str(f.closingDays));
  if (Number.isFinite(closing) && closing > 0) parts.push(`closing in ${closing} days`);
  const posted = Number(str(f.postedDays));
  if (Number.isFinite(posted) && posted > 0) parts.push(`posted in last ${posted} days`);
  return parts.join(' · ');
}

export interface SavedSearchItem {
  id: string;
  name: string;
  modeLabel: string | null;
  summary: string;
  alertsOn: boolean;
  createdAt: string | null;
  mapHref: string | null;
  /** Unseen matches from ?badge=1. null = not counted (never shown as 0). */
  newCount: number | null;
  /** Owner-facing reason this search cannot email (from the list API), or null. */
  alertBlock: string | null;
}

export function toSavedSearchItems(
  searches: unknown,
  perSearch?: unknown,
): SavedSearchItem[] {
  if (!Array.isArray(searches)) return [];
  const counts = new Map<string, number>();
  if (Array.isArray(perSearch)) {
    for (const p of perSearch as Array<{ id?: unknown; count?: unknown }>) {
      if (p && typeof p.count === 'number' && p.id != null) counts.set(String(p.id), p.count);
    }
  }
  const out: SavedSearchItem[] = [];
  for (const s of searches as Array<Record<string, unknown>>) {
    const id = str(s?.id);
    if (!id) continue;
    out.push({
      id,
      name: str(s.name) || 'Saved search',
      modeLabel: savedSearchModeLabel(s.mode),
      summary: summarizeSavedSearchFilters(s.filters),
      alertsOn: s.alerts_enabled === true,
      createdAt: str(s.created_at) || null,
      mapHref: mapLinkForSavedSearch(id),
      newCount: counts.has(id) ? (counts.get(id) as number) : null,
      alertBlock: str(s.alert_block) || null,
    });
  }
  return out;
}
