'use client';

/**
 * getmindy.ai/mcp — usage Overview charts (the "separate view" the balance strip
 * links to). Enterprise-console pattern: KPI tiles → usage-over-time → spend-by-tool.
 *
 * These are magnitude-by-category charts (how many credits each tool/day spent), NOT
 * identity charts — so every bar is ONE brand hue (emerald), values are direct-labeled,
 * and names wear slate ink. No per-tool rainbow (that would be cycling categorical color
 * across 15+ tools). Lightweight CSS/SVG bars — no chart lib, no hydration cost — with
 * native hover tooltips. Dark surface only (the whole /mcp page is [color-scheme:dark]).
 */

import { CARD, SURFACE_1, SURFACE_2 } from './catalog-ui';

export interface ToolSpend { tool: string; calls: number; credits: number }
export interface DaySpend { date: string; calls: number; credits: number }
export interface UsageSummary {
  windowDays: number;
  totalCredits: number;
  totalCalls: number;
  byTool: ToolSpend[];
  byDay: DaySpend[];
  capped: boolean;
}

export interface McpCall { tool_name: string; status: string; credits_charged: number | null; created_at: string }

/** snake_case tool name → "Title Case" (matches Claude Desktop's tool labels). */
export function prettifyTool(name: string): string {
  return name.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

/** Compact "3m ago" / "2h ago" / "Jul 14" from an ISO timestamp. */
export function shortWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const min = Math.floor((Date.now() - then) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Call status → { label, text colour, dot colour } for the activity row.
 *
 * `success` is deliberately NOT emerald any more. Emerald is the action accent (buttons),
 * and in a log where ~95% of rows succeed, painting the expected case in the brand colour
 * made a wall of green that drew the eye to the least interesting information. Success is
 * now quiet slate; only the states that need attention carry colour.
 */
export function statusStyle(status: string): { label: string; cls: string; dot: string } {
  switch (status) {
    case 'success': return { label: 'success', cls: 'text-slate-400', dot: 'bg-slate-500' };
    case 'uncharged': return { label: 'free (race)', cls: 'text-slate-400', dot: 'bg-slate-600' };
    case 'rejected_no_credits': return { label: 'no credits', cls: 'text-amber-300', dot: 'bg-amber-400' };
    case 'gated': return { label: 'Pro only', cls: 'text-amber-300', dot: 'bg-amber-400' };
    case 'failed': return { label: 'failed', cls: 'text-rose-300', dot: 'bg-rose-400' };
    default: return { label: status, cls: 'text-slate-400', dot: 'bg-slate-600' };
  }
}

const TOP_TOOLS = 8;

/** "Jul 14" from a YYYY-MM-DD string (parsed as local midnight, no TZ shift surprises). */
function shortDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---- KPI tiles -----------------------------------------------------------------
function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={`${CARD} px-4 py-3.5`}>
      <div className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-slate-500">{label}</div>
      {/* Was text-[19px] + truncate, which clipped "Generate Market Report" to
          "Generate …". Wrap to two lines instead of hiding the answer. */}
      <div className="mt-1.5 text-[22px] font-semibold leading-tight tabular-nums text-slate-50" title={value}>{value}</div>
      {sub && <div className="mt-1 truncate text-[11.5px] tabular-nums text-slate-500">{sub}</div>}
    </div>
  );
}

export function UsageKpis({ usage }: { usage: UsageSummary }) {
  const avg = usage.totalCalls > 0 ? usage.totalCredits / usage.totalCalls : 0;
  const top = usage.byTool.find((t) => t.credits > 0) ?? usage.byTool[0];
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      <Tile label={`Spent · ${usage.windowDays}d`} value={`${usage.totalCredits.toLocaleString()} cr`} />
      <Tile label={`Calls · ${usage.windowDays}d`} value={usage.totalCalls.toLocaleString()} />
      <Tile label="Avg / call" value={`${avg.toFixed(avg >= 10 ? 0 : 1)} cr`} />
      <Tile label="Top tool" value={top ? prettifyTool(top.tool) : '—'} sub={top ? `${top.credits} cr · ${top.calls} calls` : undefined} />
    </div>
  );
}

// ---- Usage over time (vertical bars, one per day) ------------------------------
/**
 * `chartDays` (default 7) is the number of trailing days the bar chart shows — kept
 * separate from the totals window so the graph stays dense/readable even when the
 * KPI rollups span 30 days. Each bar is direct-labeled with its credit total.
 */
export function UsageOverTime({ byDay, chartDays = 7 }: { byDay: DaySpend[]; chartDays?: number }) {
  // Build a continuous daily axis so gaps read as real zero-usage days.
  const spend = new Map(byDay.map((d) => [d.date, d]));
  const today = new Date();
  const days: DaySpend[] = [];
  for (let i = chartDays - 1; i >= 0; i--) {
    const dt = new Date(today);
    dt.setDate(today.getDate() - i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    days.push(spend.get(key) ?? { date: key, calls: 0, credits: 0 });
  }
  const peak = Math.max(...days.map((d) => d.credits));
  // Round the axis top to a clean number so the gridline labels are readable
  // (205 → 250, not 205). A flat-zero window still gets a sane 1-unit scale.
  const niceMax = (() => {
    if (peak <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(peak)));
    return Math.ceil(peak / (mag / 2)) * (mag / 2);
  })();
  const gridlines = [1, 0.5, 0];

  return (
    <div className="flex gap-2.5">
      {/* Y axis — a real scale. Values used to float above each bar with no axis at
          all, so a 25 next to a 205 was unreadable as magnitude. */}
      <div className="relative h-36 w-9 shrink-0">
        {gridlines.map((g) => (
          <span
            key={g}
            className="absolute right-0 -translate-y-1/2 text-[10px] tabular-nums text-slate-600"
            style={{ top: `${(1 - g) * 100}%` }}
          >
            {Math.round(niceMax * g).toLocaleString()}
          </span>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        <div className="relative h-36" role="img" aria-label={`Credits spent per day over the last ${chartDays} days`}>
          {/* gridlines behind the bars */}
          {gridlines.map((g) => (
            <div
              key={g}
              className={`absolute inset-x-0 border-t ${g === 0 ? 'border-white/[0.13]' : 'border-white/[0.05]'}`}
              style={{ top: `${(1 - g) * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-1.5">
            {days.map((d) => {
              const pct = (d.credits / niceMax) * 100;
              return (
                <div
                  key={d.date}
                  className="group relative flex h-full flex-1 items-end"
                  title={`${shortDay(d.date)}: ${d.credits.toLocaleString()} cr · ${d.calls} call${d.calls === 1 ? '' : 's'}`}
                >
                  {/* Neutral bars, not brand-green: this is magnitude data, and the accent
                      is reserved for actions. min-height 2px keeps a small-but-real day
                      visible instead of vanishing next to a peak. */}
                  <div
                    className={`w-full rounded-t-[2px] transition-colors ${d.credits > 0 ? 'bg-slate-400/45 group-hover:bg-slate-300/70' : 'bg-white/[0.045]'}`}
                    style={{ height: d.credits > 0 ? `max(${pct}%, 2px)` : '2px' }}
                  />
                  {/* value on hover only — no permanent label clutter */}
                  {d.credits > 0 && (
                    <span className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded bg-[#0b1120] px-1.5 py-0.5 text-[10px] tabular-nums text-slate-200 opacity-0 shadow-sm ring-1 ring-white/10 transition-opacity group-hover:opacity-100">
                      {d.credits.toLocaleString()}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-1.5 flex gap-1.5">
          {days.map((d) => (
            <span key={d.date} className="flex-1 truncate text-center text-[10px] leading-none text-slate-600">{shortDay(d.date)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Spend by tool (horizontal bars) -------------------------------------------
export function SpendByTool({ byTool }: { byTool: ToolSpend[] }) {
  const spenders = byTool.filter((t) => t.credits > 0);
  if (spenders.length === 0) {
    return <p className="text-[13px] text-slate-500">No credit spend in this window yet.</p>;
  }
  const shown = spenders.slice(0, TOP_TOOLS);
  const hidden = spenders.slice(TOP_TOOLS);
  const max = Math.max(1, ...shown.map((t) => t.credits));
  const hiddenCredits = hidden.reduce((s, t) => s + t.credits, 0);

  return (
    <div className="space-y-2">
      {shown.map((t) => {
        const pct = (t.credits / max) * 100;
        const name = prettifyTool(t.tool);
        return (
          <div key={t.tool} className="group flex items-center gap-3" title={`${name}: ${t.credits} cr across ${t.calls} call${t.calls === 1 ? '' : 's'}`}>
            <div className="w-36 shrink-0 truncate text-[13px] text-slate-300 sm:w-48">{name}</div>
            {/* Neutral ramp, not emerald — magnitude data, and the accent belongs to
                actions. Rank still reads clearly from length alone. */}
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-white/[0.035]">
              <div className="absolute inset-y-0 left-0 rounded bg-slate-400/45 transition-colors group-hover:bg-slate-300/70" style={{ width: `${Math.max(pct, 1.5)}%` }} />
            </div>
            <div className="w-[92px] shrink-0 text-right text-[12px] tabular-nums text-slate-500">
              <span className="font-medium text-slate-200">{t.credits.toLocaleString()}</span> cr · {t.calls}
            </div>
          </div>
        );
      })}
      {hidden.length > 0 && (
        <p className="pt-1 text-[12px] text-slate-500">
          + {hidden.length} more tool{hidden.length === 1 ? '' : 's'} · {hiddenCredits} cr
        </p>
      )}
    </div>
  );
}

// ---- Activity log (raw call table) ---------------------------------------------
export function ActivityLog({ calls }: { calls: McpCall[] }) {
  if (calls.length === 0) {
    return <p className="text-[13px] text-slate-500">No tool calls yet. Connect Mindy to your agent and run a tool — every call shows up here with its credit cost.</p>;
  }
  return (
    <div className={`overflow-hidden rounded-xl ${SURFACE_1}`}>
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[460px] text-left text-[13px]">
          {/* Sticky header on its own surface — a long log stays readable while scrolling. */}
          <thead className="sticky top-0 z-10">
            <tr className={`${SURFACE_2} text-[10.5px] uppercase tracking-[0.1em] text-slate-500`}>
              <th className="px-4 py-2.5 font-medium">Tool</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Credits</th>
              <th className="px-4 py-2.5 text-right font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c, i) => {
              const st = statusStyle(c.status);
              return (
                // Tighter rows (~36px, was ~52) so a scan-heavy log shows more at once,
                // plus a hover row — the old table had no way to track your eye across.
                <tr key={i} className="border-t border-white/[0.05] transition-colors hover:bg-white/[0.025]">
                  <td className="px-4 py-2 text-slate-200">{prettifyTool(c.tool_name)}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center gap-1.5 text-[12px] ${st.cls}`}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.dot}`} />
                      {st.label}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-200">{c.credits_charged || 0}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-500">{shortWhen(c.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
