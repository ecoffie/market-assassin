/**
 * Quarterly Funder Report rollup (PRD-capability-milestones-funder-report §4).
 *
 * Org-level rollup a center hands its funder (for GCAP: SBTDC/SBA): businesses served,
 * capability milestones reached (counts + per-business), and pipeline outcomes (bids/awards)
 * for a quarter. v1 layout is generic-solid; reshaped to a specific funder's template later.
 *
 * READ-ONLY across all sources. Pure functions here; the route does the Supabase I/O.
 */

import { MILESTONE_KEYS, MILESTONE_LABELS, type MilestoneKey } from './client-milestones';

export interface QuarterRange {
  label: string; // "2026-Q1"
  startISO: string;
  endISO: string;
}

/** Parse "YYYY-Qn" into an inclusive-start / exclusive-end ISO range. */
export function parseQuarter(q: string): QuarterRange | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(q.trim());
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const quarter = parseInt(m[2], 10);
  const startMonth = (quarter - 1) * 3; // 0,3,6,9
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 1));
  return { label: `${m[1]}-Q${m[2]}`, startISO: start.toISOString(), endISO: end.toISOString() };
}

export interface ClientReportRow {
  businessName: string;
  workspaceId: string;
  assignedCoach: string | null;
  milestones: Record<MilestoneKey, string | null>; // key -> achieved_at (or null)
  bidsInQuarter: number;
  awardsInQuarter: number;
}

export interface FunderReport {
  quarter: string;
  generatedAt: string;
  orgName: string;
  businessesServed: number;
  milestoneCounts: Record<MilestoneKey, number>; // # businesses that have reached each (ever)
  milestoneReachedInQuarter: Record<MilestoneKey, number>; // # reached DURING the quarter
  totalBidsInQuarter: number;
  totalAwardsInQuarter: number;
  clients: ClientReportRow[];
}

function inRange(iso: string | null | undefined, r: QuarterRange): boolean {
  if (!iso) return false;
  return iso >= r.startISO && iso < r.endISO;
}

/**
 * Assemble the report from already-fetched rows. Kept pure so it's unit-testable and the
 * route just feeds it DB results.
 */
export function buildFunderReport(args: {
  quarter: QuarterRange;
  orgName: string;
  generatedAt: string;
  clients: Array<{ businessName: string; workspaceId: string; assignedCoach: string | null }>;
  milestoneRows: Array<{ workspace_id: string; milestone_key: string; achieved_at: string | null }>;
  pipelineRows: Array<{ workspace_id: string; stage: string; outcome_date: string | null; updated_at: string | null; created_at: string | null }>;
}): FunderReport {
  const { quarter, orgName, generatedAt, clients, milestoneRows, pipelineRows } = args;

  const milestoneByWs = new Map<string, Map<MilestoneKey, string | null>>();
  for (const r of milestoneRows) {
    if (!MILESTONE_KEYS.includes(r.milestone_key as MilestoneKey)) continue;
    const key = r.milestone_key as MilestoneKey;
    const m = milestoneByWs.get(r.workspace_id) || new Map<MilestoneKey, string | null>();
    m.set(key, r.achieved_at);
    milestoneByWs.set(r.workspace_id, m);
  }

  // Bids/awards per workspace within the quarter.
  const bidsByWs = new Map<string, number>();
  const awardsByWs = new Map<string, number>();
  for (const p of pipelineRows) {
    const when = p.outcome_date || p.updated_at || p.created_at || null;
    if (!inRange(when, quarter)) continue;
    if (['submitted', 'won', 'lost'].includes(p.stage)) {
      bidsByWs.set(p.workspace_id, (bidsByWs.get(p.workspace_id) || 0) + 1);
    }
    if (p.stage === 'won') {
      awardsByWs.set(p.workspace_id, (awardsByWs.get(p.workspace_id) || 0) + 1);
    }
  }

  const milestoneCounts = Object.fromEntries(MILESTONE_KEYS.map((k) => [k, 0])) as Record<MilestoneKey, number>;
  const milestoneReachedInQuarter = Object.fromEntries(MILESTONE_KEYS.map((k) => [k, 0])) as Record<MilestoneKey, number>;

  const rows: ClientReportRow[] = clients.map((c) => {
    const ms = milestoneByWs.get(c.workspaceId) || new Map<MilestoneKey, string | null>();
    const milestones = Object.fromEntries(
      MILESTONE_KEYS.map((k) => [k, ms.get(k) ?? null]),
    ) as Record<MilestoneKey, string | null>;
    for (const k of MILESTONE_KEYS) {
      if (milestones[k]) {
        milestoneCounts[k] += 1;
        if (inRange(milestones[k], quarter)) milestoneReachedInQuarter[k] += 1;
      }
    }
    return {
      businessName: c.businessName,
      workspaceId: c.workspaceId,
      assignedCoach: c.assignedCoach,
      milestones,
      bidsInQuarter: bidsByWs.get(c.workspaceId) || 0,
      awardsInQuarter: awardsByWs.get(c.workspaceId) || 0,
    };
  });

  return {
    quarter: quarter.label,
    generatedAt,
    orgName,
    businessesServed: clients.length,
    milestoneCounts,
    milestoneReachedInQuarter,
    totalBidsInQuarter: [...bidsByWs.values()].reduce((a, b) => a + b, 0),
    totalAwardsInQuarter: [...awardsByWs.values()].reduce((a, b) => a + b, 0),
    clients: rows,
  };
}

function csvCell(v: string | number | null): string {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Render the report as CSV (per-business rows + a header summary block). */
export function reportToCsv(r: FunderReport): string {
  const lines: string[] = [];
  lines.push(`Funder Report,${csvCell(r.orgName)},${r.quarter}`);
  lines.push(`Generated,${r.generatedAt}`);
  lines.push(`Businesses served,${r.businessesServed}`);
  lines.push(`Total bids in quarter,${r.totalBidsInQuarter}`);
  lines.push(`Total awards in quarter,${r.totalAwardsInQuarter}`);
  lines.push('');
  lines.push('Milestone,Total reached (ever),Reached this quarter');
  for (const k of MILESTONE_KEYS) {
    lines.push(`${csvCell(MILESTONE_LABELS[k])},${r.milestoneCounts[k]},${r.milestoneReachedInQuarter[k]}`);
  }
  lines.push('');
  const header = ['Business', 'Assigned counselor', ...MILESTONE_KEYS.map((k) => MILESTONE_LABELS[k]), 'Bids (qtr)', 'Awards (qtr)'];
  lines.push(header.map(csvCell).join(','));
  for (const c of r.clients) {
    const cells = [
      c.businessName,
      c.assignedCoach || '',
      ...MILESTONE_KEYS.map((k) => (c.milestones[k] ? c.milestones[k]!.slice(0, 10) : '')),
      c.bidsInQuarter,
      c.awardsInQuarter,
    ];
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\n');
}

/** Render the report as a self-contained HTML doc (Puppeteer prints this to PDF). */
export function reportToHtml(r: FunderReport): string {
  const rows = r.clients
    .map((c) => {
      const ms = MILESTONE_KEYS.map((k) => `<td>${c.milestones[k] ? c.milestones[k]!.slice(0, 10) : '—'}</td>`).join('');
      return `<tr><td>${escapeHtml(c.businessName)}</td><td>${escapeHtml(c.assignedCoach || '—')}</td>${ms}<td>${c.bidsInQuarter}</td><td>${c.awardsInQuarter}</td></tr>`;
    })
    .join('');
  const summary = MILESTONE_KEYS.map(
    (k) => `<tr><td>${MILESTONE_LABELS[k]}</td><td>${r.milestoneCounts[k]}</td><td>${r.milestoneReachedInQuarter[k]}</td></tr>`,
  ).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;font-size:12px;padding:28px;}
    h1{font-size:18px;color:#1e3a8a;margin:0 0 2px;} .sub{color:#64748b;font-size:12px;margin-bottom:16px;}
    .kpis{display:flex;gap:16px;margin:12px 0 20px;} .kpi{border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;}
    .kpi b{font-size:20px;color:#1e3a8a;display:block;} .kpi span{color:#64748b;font-size:11px;}
    table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:18px;} th,td{border:1px solid #e2e8f0;padding:5px 7px;text-align:left;}
    th{background:#f1f5f9;color:#1e3a8a;} h3{font-size:13px;color:#7c3aed;text-transform:uppercase;letter-spacing:.05em;margin:8px 0;}
  </style></head><body>
    <h1>${escapeHtml(r.orgName)} — Capability Progression Report</h1>
    <div class="sub">${r.quarter} · generated ${r.generatedAt.slice(0, 10)}</div>
    <div class="kpis">
      <div class="kpi"><b>${r.businessesServed}</b><span>Businesses served</span></div>
      <div class="kpi"><b>${r.totalBidsInQuarter}</b><span>Bids this quarter</span></div>
      <div class="kpi"><b>${r.totalAwardsInQuarter}</b><span>Awards this quarter</span></div>
    </div>
    <h3>Milestones reached</h3>
    <table><tr><th>Milestone</th><th>Total (ever)</th><th>This quarter</th></tr>${summary}</table>
    <h3>By business</h3>
    <table><tr><th>Business</th><th>Counselor</th>${MILESTONE_KEYS.map((k) => `<th>${MILESTONE_LABELS[k]}</th>`).join('')}<th>Bids</th><th>Awards</th></tr>${rows}</table>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}
