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

/** Call status → { label, className } for the activity row chip. */
export function statusStyle(status: string): { label: string; cls: string } {
  switch (status) {
    case 'success': return { label: 'success', cls: 'text-emerald-300' };
    case 'uncharged': return { label: 'free (race)', cls: 'text-slate-400' };
    case 'rejected_no_credits': return { label: 'no credits', cls: 'text-amber-300' };
    case 'gated': return { label: 'Pro only', cls: 'text-amber-300' };
    case 'failed': return { label: 'failed', cls: 'text-rose-300' };
    default: return { label: status, cls: 'text-slate-400' };
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
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-slate-500">{label}</div>
      <div className="mt-1 truncate text-[19px] font-semibold tabular-nums text-slate-100" title={value}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-slate-500">{sub}</div>}
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
  const max = Math.max(1, ...days.map((d) => d.credits));

  return (
    <div>
      <div className="flex items-end gap-1.5 h-32" role="img" aria-label={`Credits spent per day over the last ${chartDays} days`}>
        {days.map((d) => {
          const pct = (d.credits / max) * 100;
          return (
            <div key={d.date} className="group flex h-full flex-1 flex-col items-center gap-1" title={`${shortDay(d.date)}: ${d.credits} cr · ${d.calls} call${d.calls === 1 ? '' : 's'}`}>
              {/* value label — fixed row so it never overlaps the bar */}
              <span className="h-[14px] text-[11px] leading-none tabular-nums text-slate-400">{d.credits > 0 ? d.credits : ''}</span>
              {/* bar track — the bar is sized as a % of THIS row only */}
              <div className="flex w-full flex-1 items-end">
                <div
                  className={`w-full rounded-t-[3px] transition-colors ${d.credits > 0 ? 'bg-emerald-400/70 group-hover:bg-emerald-300' : 'bg-white/[0.05] group-hover:bg-white/10'}`}
                  style={{ height: d.credits > 0 ? `${Math.max(pct, 6)}%` : '3px' }}
                />
              </div>
              <span className="truncate text-[10px] leading-none text-slate-600">{shortDay(d.date)}</span>
            </div>
          );
        })}
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
            <div className="w-36 shrink-0 truncate text-[13px] text-slate-300 sm:w-44">{name}</div>
            <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-white/[0.04]">
              <div className="absolute inset-y-0 left-0 rounded-md bg-emerald-400/75 transition-colors group-hover:bg-emerald-300" style={{ width: `${Math.max(pct, 2)}%` }} />
            </div>
            <div className="w-24 shrink-0 text-right text-[12px] tabular-nums text-slate-400">
              <span className="text-slate-200">{t.credits}</span> cr · {t.calls}
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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-left text-[13px]">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-slate-500">
            <th className="pb-2 pr-4 font-medium">Tool</th>
            <th className="pb-2 pr-4 font-medium">Status</th>
            <th className="pb-2 pr-4 text-right font-medium">Credits</th>
            <th className="pb-2 text-right font-medium">When</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c, i) => {
            const st = statusStyle(c.status);
            return (
              <tr key={i} className="border-t border-white/[0.05]">
                <td className="py-2 pr-4 text-slate-200">{prettifyTool(c.tool_name)}</td>
                <td className={`py-2 pr-4 ${st.cls}`}>{st.label}</td>
                <td className="py-2 pr-4 text-right tabular-nums text-slate-300">{c.credits_charged || 0}</td>
                <td className="py-2 text-right tabular-nums text-slate-500">{shortWhen(c.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
