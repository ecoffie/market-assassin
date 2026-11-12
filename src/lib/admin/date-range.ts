/**
 * Date ranges for admin reports, in US Eastern time (the business's day).
 * Presets: today · yesterday · week (Mon–today) · month · year · 7d · 30d · 90d · custom (from/to).
 */
export const REPORT_TZ = 'America/New_York';
export const PRESETS = ['today', 'yesterday', 'week', 'month', 'year', '7d', '30d', '90d', 'custom'] as const;
export type Preset = (typeof PRESETS)[number];

export type DateRange = {
  preset: Preset;
  from: string; // YYYY-MM-DD, Eastern, inclusive
  to: string; // YYYY-MM-DD, Eastern, inclusive
  startMs: number; // UTC ms at Eastern midnight starting `from`
  endMs: number; // UTC ms at the end of `to` (exclusive), capped at now
  label: string;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** The Eastern calendar date (YYYY-MM-DD) at `ms`. */
export function easternDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: REPORT_TZ });
}

/** Offset (ms) of Eastern wall time from UTC at instant `ms` (negative: -4h or -5h). */
function easternOffsetMs(ms: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: REPORT_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
  );
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

/** UTC ms of Eastern midnight at the start of `ymd`. */
export function easternMidnightMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 12); // noon UTC is the same Eastern date
  return Date.UTC(y, m - 1, d) - easternOffsetMs(guess);
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const fmt = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

const LABELS: Record<Preset, string> = {
  today: 'Today', yesterday: 'Yesterday', week: 'This week', month: 'This month', year: 'This year',
  '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', custom: 'Custom',
};

/** Resolve `range` (+ `from`/`to` for custom) to an Eastern date range. Unknown or bad input → last 30 days. */
export function resolveRange(params: { range?: string | null; from?: string | null; to?: string | null }, nowMs = Date.now()): DateRange {
  const today = easternDate(nowMs);
  let preset = (PRESETS as readonly string[]).includes(params.range ?? '') ? (params.range as Preset) : '30d';
  let from = today;
  let to = today;
  switch (preset) {
    case 'today': break;
    case 'yesterday': from = to = addDays(today, -1); break;
    case 'week': {
      const [y, m, d] = today.split('-').map(Number);
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
      from = addDays(today, -((dow + 6) % 7)); // back to Monday
      break;
    }
    case 'month': from = `${today.slice(0, 7)}-01`; break;
    case 'year': from = `${today.slice(0, 4)}-01-01`; break;
    case '7d': from = addDays(today, -6); break;
    case '90d': from = addDays(today, -89); break;
    case 'custom': {
      const f = params.from ?? '';
      const t = params.to ?? '';
      if (YMD.test(f) && YMD.test(t) && f <= t && f <= today) {
        from = f;
        to = t > today ? today : t;
      } else {
        preset = '30d';
        from = addDays(today, -29);
      }
      break;
    }
    default: from = addDays(today, -29);
  }
  const startMs = easternMidnightMs(from);
  const endMs = Math.min(easternMidnightMs(addDays(to, 1)), nowMs);
  const label = from === to ? `${LABELS[preset]} · ${fmt(from)}` : `${LABELS[preset]} · ${fmt(from)} – ${fmt(to)}`;
  return { preset, from, to, startMs, endMs, label };
}
