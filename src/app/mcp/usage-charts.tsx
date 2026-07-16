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

/** snake_case tool name → "Title Case" (matches Claude Desktop's tool labels). */
export function prettifyTool(name: string): string {
  return name.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
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
export function UsageOverTime({ byDay, windowDays }: { byDay: DaySpend[]; windowDays: number }) {
  // Build a continuous daily axis for the window so gaps read as real zero-usage days.
  const spend = new Map(byDay.map((d) => [d.date, d]));
  const today = new Date();
  const days: DaySpend[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const dt = new Date(today);
    dt.setDate(today.getDate() - i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    days.push(spend.get(key) ?? { date: key, calls: 0, credits: 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.credits));

  return (
    <div>
      <div className="flex items-end gap-[2px] h-28" role="img" aria-label={`Credits spent per day over the last ${windowDays} days`}>
        {days.map((d) => {
          const pct = (d.credits / max) * 100;
          return (
            <div key={d.date} className="group relative flex h-full flex-1 items-end" title={`${shortDay(d.date)}: ${d.credits} cr · ${d.calls} call${d.calls === 1 ? '' : 's'}`}>
              <div
                className={`w-full rounded-t-[3px] transition-colors ${d.credits > 0 ? 'bg-emerald-400/70 group-hover:bg-emerald-300' : 'bg-white/[0.05] group-hover:bg-white/10'}`}
                style={{ height: d.credits > 0 ? `${Math.max(pct, 5)}%` : '3px' }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-slate-600">
        <span>{shortDay(days[0].date)}</span>
        <span>Today</span>
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
