/**
 * Players reconciliation — Players counts vs unique canonical awardee UEIs, per (NAICS, HQ state).
 *
 * Truth comes from `buildPlayersTruthSql` (awards + recipients directly), never from the Players
 * table, so a Players defect cannot certify itself. Pure functions; the I/O lives in
 * scripts/verify-oracles.mjs (`--only players`) and scripts/players-rebuild.ts.
 */

export interface PlayersCell { naics: string; state: string }

/** The cells that FAILED on production 2026-10-04 (audit). Current production must fail these. */
export const PLAYERS_REGRESSION_FIXTURES: ReadonlyArray<PlayersCell> = [
  { naics: '541512', state: 'TX' }, // 327 real awardees, Maps showed 0
  { naics: '238220', state: 'NY' }, // 326 real, 0 shown
  { naics: '561720', state: 'CO' }, // 133 real, 0 shown
  { naics: '541512', state: 'VA' }, // 2,349 real, 34 shown
];

/**
 * Broad, sector-spread NAICS for representative coverage (IT, A&E, construction, trades,
 * facilities, aerospace, health, trucking, forestry, education, instruments, waste) — so the
 * oracle is not one hard-coded cell.
 */
export const PLAYERS_BROAD_NAICS: ReadonlyArray<string> = [
  '541512', '541330', '541611', '541519', '236220', '238220', '561720', '561210',
  '336413', '621111', '484110', '115310', '611430', '334516', '562111',
];

/** A Players count reconciles when it is within 1% (or 1 firm) of truth, in both directions. */
export const PLAYERS_TOLERANCE = 0.01;

export function reconciles(players: number | null, truth: number): boolean {
  if (players == null) return false;
  const slack = Math.max(1, Math.ceil(truth * PLAYERS_TOLERANCE));
  return Math.abs(players - truth) <= slack;
}

export interface TruthRow { naics_code: string; state: string | null; proven_players: number }

/**
 * Deterministic sample: for every broad NAICS, the largest, median and smallest non-empty HQ
 * states — big markets, typical markets and thin markets — plus the regression fixtures.
 */
export function selectSampleCells(truth: TruthRow[], naicsList: ReadonlyArray<string> = PLAYERS_BROAD_NAICS): PlayersCell[] {
  const out = new Map<string, PlayersCell>();
  for (const f of PLAYERS_REGRESSION_FIXTURES) out.set(`${f.naics}|${f.state}`, f);
  for (const naics of naicsList) {
    const rows = truth
      .filter((r) => r.naics_code === naics && r.state && r.proven_players > 0)
      .sort((a, b) => b.proven_players - a.proven_players || String(a.state).localeCompare(String(b.state)));
    if (!rows.length) continue;
    for (const r of [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]]) {
      out.set(`${naics}|${r.state}`, { naics, state: r.state as string });
    }
  }
  return Array.from(out.values());
}

export interface CellResult extends PlayersCell { truth: number; players: number | null; status: string; ok: boolean }

export function evaluateCells(
  cells: PlayersCell[],
  truth: TruthRow[],
  measured: Map<string, { total: number | null; status: string }>,
): { results: CellResult[]; failed: CellResult[] } {
  const t = new Map(truth.map((r) => [`${r.naics_code}|${r.state}`, Number(r.proven_players)]));
  const results = cells.map((c) => {
    const k = `${c.naics}|${c.state}`;
    const m = measured.get(k) || { total: null, status: 'unmeasured' };
    const tr = t.get(k) ?? 0;
    // A partial or unknown answer never reconciles — it is exactly what this oracle exists to refuse.
    const ok = (m.status === 'success_nonzero' || m.status === 'success_zero') && reconciles(m.total, tr);
    return { ...c, truth: tr, players: m.total, status: m.status, ok };
  });
  return { results, failed: results.filter((r) => !r.ok) };
}

/** Dataset-level: every (NAICS, state) cell of the Players table vs truth. */
export function datasetMismatchRate(
  truth: TruthRow[],
  players: TruthRow[],
): { cells: number; mismatched: number; rate: number; examples: string[] } {
  const p = new Map(players.map((r) => [`${r.naics_code}|${r.state}`, Number(r.proven_players)]));
  let mismatched = 0;
  const examples: string[] = [];
  for (const r of truth) {
    const k = `${r.naics_code}|${r.state}`;
    if (!reconciles(p.get(k) ?? 0, Number(r.proven_players))) {
      mismatched++;
      if (examples.length < 8) examples.push(`${k} truth=${r.proven_players} players=${p.get(k) ?? 0}`);
    }
  }
  return { cells: truth.length, mismatched, rate: truth.length ? mismatched / truth.length : 0, examples };
}

/** Players table grouped the same way as truth — for the dataset-level comparison. */
export function buildPlayersCellCountsSql(playersTable: string): string {
  return `
SELECT naics_code, state, COUNT(*) AS proven_players
FROM ${playersTable}
GROUP BY 1, 2
`;
}
