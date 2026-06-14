/**
 * DISA Vehicle Expiry Watch — shared logic.
 *
 * One source of truth for "which stage is a vehicle in" and "what email would
 * we send the incumbent" — used by BOTH the dashboard (preview) and the cron
 * (live/dry-run send) so they never disagree. (Replaces DISA's manual
 * spreadsheet tracking of IDIQ/IDV vehicles — see DISA-VEHICLE-WATCH-SPEC.md.)
 */

export type NotifyStage = '6mo' | '90d' | '30d';

export interface WatchedVehicle {
  id: string;
  vehicle_piid: string;
  vehicle_title?: string | null;
  incumbent_name?: string | null;
  incumbent_uei?: string | null;
  incumbent_email?: string | null;
  expiration_date?: string | null; // YYYY-MM-DD
  ceiling_value?: number | null;
  naics?: string | null;
  agency?: string | null;
  notify_6mo?: boolean;
  notify_90d?: boolean;
  notify_30d?: boolean;
  last_notified_stage?: string | null;
}

// Stage thresholds in days. A vehicle is "due" for a stage when it expires within
// that window AND we haven't already sent that stage (or a later/closer one).
const STAGE_DAYS: Record<NotifyStage, number> = { '6mo': 183, '90d': 90, '30d': 30 };
// Closer stages supersede earlier ones (don't re-send 6mo after we've sent 90d).
const STAGE_ORDER: NotifyStage[] = ['6mo', '90d', '30d'];

/** Whole days from `now` until the expiration date (negative if already expired). */
export function daysUntil(expiration: string | null | undefined, now: Date): number | null {
  if (!expiration) return null;
  const exp = new Date(`${expiration}T00:00:00Z`);
  if (Number.isNaN(exp.getTime())) return null;
  const ms = exp.getTime() - now.getTime();
  return Math.floor(ms / 86_400_000);
}

function stageEnabled(v: WatchedVehicle, stage: NotifyStage): boolean {
  if (stage === '6mo') return v.notify_6mo !== false;
  if (stage === '90d') return v.notify_90d !== false;
  return v.notify_30d !== false;
}

/**
 * The stage a vehicle is currently IN (closest threshold it has crossed), or null.
 * e.g. 120 days out → '6mo'; 75 days → '90d'; 20 days → '30d'; 400 days → null.
 */
export function currentStage(v: WatchedVehicle, now: Date): NotifyStage | null {
  const d = daysUntil(v.expiration_date, now);
  if (d === null || d < 0) return null; // unknown or already expired
  let hit: NotifyStage | null = null;
  for (const stage of STAGE_ORDER) {
    if (d <= STAGE_DAYS[stage] && stageEnabled(v, stage)) hit = stage; // closer stages win
  }
  return hit;
}

/**
 * Is this vehicle DUE for a notification right now? True when it's in a stage we
 * haven't already notified at (closer than last_notified_stage).
 */
export function isDue(v: WatchedVehicle, now: Date): NotifyStage | null {
  const stage = currentStage(v, now);
  if (!stage) return null;
  const last = (v.last_notified_stage || '') as NotifyStage | '';
  if (!last) return stage;
  // Only fire if the current stage is CLOSER than what we last sent.
  return STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(last) ? stage : null;
}

const STAGE_LABEL: Record<NotifyStage, string> = {
  '6mo': 'approximately six months',
  '90d': 'approximately 90 days',
  '30d': 'approximately 30 days',
};

/** The exact email that WOULD be sent to the incumbent (used for dry-run preview + live send). */
export function buildIncumbentNotice(v: WatchedVehicle, stage: NotifyStage, now: Date): {
  to: string | null;
  subject: string;
  body: string;
} {
  const d = daysUntil(v.expiration_date, now);
  const piid = v.vehicle_piid || '[contract number]';
  const title = v.vehicle_title ? `"${v.vehicle_title}"` : 'your contract vehicle';
  const expText = v.expiration_date || '[expiration date]';
  const name = v.incumbent_name || 'Valued Contractor';

  const subject = `Notice: ${piid} approaches expiration (${STAGE_LABEL[stage]} remaining)`;
  const body = [
    `Dear ${name},`,
    ``,
    `This is an automated courtesy notice regarding contract vehicle ${piid} (${title}), ` +
      `for which our records show a period of performance ending on ${expText} — ` +
      `${STAGE_LABEL[stage]} from today${typeof d === 'number' ? ` (${d} days)` : ''}.`,
    ``,
    `Please ensure your team is prepared for the upcoming recompete or close-out actions ` +
      `associated with this vehicle. If you have questions about the schedule or next steps, ` +
      `contact the cognizant contracting office.`,
    ``,
    `This notice was generated automatically from the vehicle tracking system.`,
  ].join('\n');

  return { to: v.incumbent_email || null, subject, body };
}

/** Dashboard rollup numbers — the "screenshot moment." */
export function summarize(vehicles: WatchedVehicle[], now: Date) {
  let in6mo = 0, in90d = 0, in30d = 0, expired = 0, missingEmail = 0, notifiedThisCycle = 0;
  for (const v of vehicles) {
    const d = daysUntil(v.expiration_date, now);
    if (d === null) continue;
    if (d < 0) { expired++; continue; }
    if (d <= STAGE_DAYS['30d']) in30d++;
    else if (d <= STAGE_DAYS['90d']) in90d++;
    else if (d <= STAGE_DAYS['6mo']) in6mo++;
    if (!v.incumbent_email) missingEmail++;
    if (v.last_notified_stage) notifiedThisCycle++;
  }
  return {
    total: vehicles.length,
    expiringIn6mo: in6mo + in90d + in30d, // everything inside the 6-month watch window
    expiringIn90d: in90d + in30d,
    expiringIn30d: in30d,
    expired,
    missingEmail,
    notified: notifiedThisCycle,
  };
}

/** Parse a DISA vehicle CSV. Tolerant of common header names. */
export function parseVehicleCsv(text: string): Array<Partial<WatchedVehicle>> {
  // Strip NUL bytes (Postgres rejects them) + normalize line endings.
  const clean = text.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
  const lines = clean.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const col = (names: string[]) => headers.findIndex(h => names.some(n => h.includes(n)));

  const iPiid = col(['piid', 'contract', 'vehicle', 'award']);
  const iTitle = col(['title', 'description', 'name of']);
  const iIncName = col(['incumbent', 'vendor', 'contractor', 'recipient', 'company']);
  const iEmail = col(['email', 'e-mail', 'poc email', 'contact']);
  const iExp = col(['expiration', 'expiry', 'end date', 'pop end', 'completion']);
  const iCeiling = col(['ceiling', 'value', 'amount']);
  const iNaics = col(['naics']);
  const iUei = col(['uei']);

  const out: Array<Partial<WatchedVehicle>> = [];
  for (let r = 1; r < lines.length; r++) {
    const c = splitCsvLine(lines[r]);
    const piid = iPiid >= 0 ? (c[iPiid] || '').trim() : '';
    if (!piid) continue;
    out.push({
      vehicle_piid: piid,
      vehicle_title: iTitle >= 0 ? (c[iTitle] || '').trim() || null : null,
      incumbent_name: iIncName >= 0 ? (c[iIncName] || '').trim() || null : null,
      incumbent_email: iEmail >= 0 ? (c[iEmail] || '').trim() || null : null,
      incumbent_uei: iUei >= 0 ? (c[iUei] || '').trim() || null : null,
      expiration_date: iExp >= 0 ? normalizeDate((c[iExp] || '').trim()) : null,
      ceiling_value: iCeiling >= 0 ? parseNumber(c[iCeiling]) : null,
      naics: iNaics >= 0 ? (c[iNaics] || '').trim() || null : null,
    });
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  // Minimal CSV: handles quoted fields with embedded commas.
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseNumber(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Normalize common date formats to YYYY-MM-DD; return null if unparseable. */
function normalizeDate(s: string): string | null {
  if (!s) return null;
  // Already ISO-ish
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;
  // MM/DD/YYYY or M/D/YY
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) {
    const yr = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${yr}-${pad(us[1])}-${pad(us[2])}`;
  }
  return null;
}
function pad(n: string): string { return n.padStart(2, '0'); }
