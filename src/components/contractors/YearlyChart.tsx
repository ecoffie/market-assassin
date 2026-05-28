'use client';

/**
 * Year-Over-Year vertical bar chart for the contractor profile.
 *
 * Why client component: Recharts ships an SVG-based interactive chart.
 * Tooltips, hover states, responsive resizing all need browser APIs.
 *
 * Visual spec follows enterprise-finance convention (Yahoo Finance,
 * Macrotrends, USAspending, HigherGov):
 *   - Vertical bars, years on X-axis left→right oldest→newest
 *   - Y-axis abbreviated $ (e.g. "$10B"), zero baseline
 *   - Always-visible $ label above each bar (compact form)
 *   - Hover tooltip with full precision + YoY % + award count
 *   - Current-fiscal-year bar gets striped / lower-opacity treatment
 *     so users know it's partial-year (YTD), not annualized
 *   - Single Mindy-purple solid fill (no gradients, no per-bar variation)
 *
 * Inputs come pre-shaped from the server component — keeps this island
 * tiny and free of BigQuery / data deps.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface YearlyChartDatum {
  fiscal_year: number;
  total_obligated: number;
  award_count: number;
}

interface Props {
  data: YearlyChartDatum[];
  /** FY of "right now" — that bar will be rendered as YTD/partial */
  currentFiscalYear?: number;
}

function fmtCompactCurrency(n: number): string {
  if (!n || n <= 0) return '$0';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtFullCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

interface TooltipPayload {
  payload: YearlyChartDatum & { yoy_pct: number | null; is_partial: boolean };
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipPayload[];
}

function YoyTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  const yoy = d.yoy_pct;
  const yoyText =
    yoy === null
      ? null
      : yoy >= 0
        ? `▲ +${(yoy * 100).toFixed(1)}% vs FY ${d.fiscal_year - 1}`
        : `▼ ${(yoy * 100).toFixed(1)}% vs FY ${d.fiscal_year - 1}`;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/95 p-3 shadow-xl backdrop-blur-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        FY {d.fiscal_year}
        {d.is_partial && <span className="ml-2 text-amber-400">(YTD)</span>}
      </p>
      <p className="mt-1 text-base font-bold text-white">{fmtFullCurrency(d.total_obligated)}</p>
      <p className="text-xs text-slate-400">{d.award_count.toLocaleString()} awards</p>
      {yoyText && (
        <p
          className={`mt-1 text-xs font-semibold ${
            (yoy ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {yoyText}
        </p>
      )}
    </div>
  );
}

export function YearlyChart({ data, currentFiscalYear }: Props) {
  if (!data || data.length === 0) {
    return <p className="text-slate-400 text-sm">No fiscal-year data available.</p>;
  }

  // Enrich data with YoY delta + is_partial flag
  const cy = currentFiscalYear ?? new Date().getFullYear();
  const enriched = data.map((d, i) => {
    const prev = i > 0 ? Number(data[i - 1].total_obligated) : null;
    const curr = Number(d.total_obligated);
    const yoy_pct = prev && prev > 0 ? (curr - prev) / prev : null;
    return {
      ...d,
      total_obligated: curr,
      yoy_pct,
      is_partial: d.fiscal_year >= cy,
    };
  });

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer>
        <BarChart data={enriched} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="#1e293b" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="fiscal_year"
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            tickFormatter={(v) => `FY${String(v).slice(-2)}`}
            axisLine={{ stroke: '#334155' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickFormatter={(v) => fmtCompactCurrency(Number(v))}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip
            content={<YoyTooltip />}
            cursor={{ fill: '#7c3aed', fillOpacity: 0.08 }}
          />
          <Bar dataKey="total_obligated" radius={[4, 4, 0, 0]} maxBarSize={64}>
            {enriched.map((entry, idx) => (
              <Cell
                key={`cell-${idx}`}
                fill="#7c3aed"
                fillOpacity={entry.is_partial ? 0.5 : 1}
              />
            ))}
            <LabelList
              dataKey="total_obligated"
              position="top"
              formatter={(value: number) => fmtCompactCurrency(Number(value))}
              fill="#e2e8f0"
              fontSize={11}
              fontWeight={600}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
