'use client';

/**
 * Contractor analytics block — three views (Trend / Drilldown / Treemap)
 * with a period selector (1Y / 3Y / 5Y / 10Y / All).
 *
 * Why a single client island: tab switching, period filtering, hover
 * tooltips, and treemap layout all need browser state. The server page
 * passes pre-shaped data; this component does view-mode + filter logic.
 *
 * Design references (per research agent + Eric's "fortune 100" ask):
 *   - Yahoo Finance / Macrotrends pattern for the Trend view
 *   - USAspending's stacked-by-agency pattern for the Drilldown view
 *   - GovTribe's treemap pattern (without the funding-type breakdown
 *     since we don't load grants/subawards yet)
 */
import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from 'recharts';

export interface YearlyDatum {
  fiscal_year: number;
  total_obligated: number;
  award_count: number;
}

export interface YearlyByAgencyDatum {
  fiscal_year: number;
  awarding_agency: string;
  total_amount: number;
  award_count: number;
}

export interface NaicsTreemapDatum {
  naics_code: string;
  naics_description: string;
  total_amount: number;
  award_count: number;
}

interface Props {
  yearly: YearlyDatum[];
  yearlyByAgency: YearlyByAgencyDatum[];
  treemapNaics: NaicsTreemapDatum[];
  currentFiscalYear?: number;
}

type View = 'trend' | 'drilldown' | 'treemap';
type Period = '1Y' | '3Y' | '5Y' | '10Y' | 'ALL';

// Tableau-style 10-color qualitative palette — visually distinct on dark
// backgrounds, no awkward red/green ambiguity. Reserved colors[0] for
// Mindy purple to anchor the brand.
const AGENCY_COLORS = [
  '#7c3aed', // mindy purple
  '#06b6d4', // cyan
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ec4899', // pink
  '#3b82f6', // blue
  '#84cc16', // lime
  '#f97316', // orange
];
const OTHER_COLOR = '#64748b'; // slate

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

function filterByPeriod<T extends { fiscal_year: number }>(rows: T[], period: Period, cy: number): T[] {
  if (period === 'ALL') return rows;
  const years = period === '1Y' ? 1 : period === '3Y' ? 3 : period === '5Y' ? 5 : 10;
  const minYear = cy - years + 1;
  return rows.filter((r) => r.fiscal_year >= minYear);
}

// ---------- Trend View (single-series vertical bars) ----------

interface TrendTooltipPayload {
  payload: YearlyDatum & { yoy_pct: number | null; is_partial: boolean };
}
interface TrendTooltipProps {
  active?: boolean;
  payload?: TrendTooltipPayload[];
}

function TrendTooltip({ active, payload }: TrendTooltipProps) {
  if (!active || !payload || !payload.length) return null;
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
        <p className={`mt-1 text-xs font-semibold ${(yoy ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {yoyText}
        </p>
      )}
    </div>
  );
}

function TrendView({ data, currentFiscalYear }: { data: YearlyDatum[]; currentFiscalYear: number }) {
  const enriched = data.map((d, i) => {
    const prev = i > 0 ? Number(data[i - 1].total_obligated) : null;
    const curr = Number(d.total_obligated);
    return {
      ...d,
      total_obligated: curr,
      yoy_pct: prev && prev > 0 ? (curr - prev) / prev : null,
      is_partial: d.fiscal_year >= currentFiscalYear,
    };
  });

  return (
    <div className="h-[360px] w-full">
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
          <Tooltip content={<TrendTooltip />} cursor={{ fill: '#7c3aed', fillOpacity: 0.08 }} />
          <Bar dataKey="total_obligated" radius={[4, 4, 0, 0]} maxBarSize={64}>
            {enriched.map((entry, idx) => (
              <Cell key={`c-${idx}`} fill="#7c3aed" fillOpacity={entry.is_partial ? 0.5 : 1} />
            ))}
            <LabelList
              dataKey="total_obligated"
              position="top"
              formatter={(v) => fmtCompactCurrency(Number(v ?? 0))}
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

// ---------- Drilldown View (stacked bars by agency) ----------

function buildStackedData(rows: YearlyByAgencyDatum[]): {
  data: Array<Record<string, number | string>>;
  topAgencies: string[];
} {
  // 1) Identify top 7 agencies by all-time spend across the rows we have
  const allTimeByAgency = new Map<string, number>();
  for (const r of rows) {
    allTimeByAgency.set(r.awarding_agency, (allTimeByAgency.get(r.awarding_agency) ?? 0) + Number(r.total_amount));
  }
  const topAgencies = [...allTimeByAgency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([name]) => name);
  const topSet = new Set(topAgencies);

  // 2) Pivot to wide format: { fiscal_year, "Dept of Defense": $, ..., "Other": $ }
  const byYear = new Map<number, Record<string, number | string>>();
  for (const r of rows) {
    if (!byYear.has(r.fiscal_year)) byYear.set(r.fiscal_year, { fiscal_year: r.fiscal_year });
    const row = byYear.get(r.fiscal_year)!;
    const bucket = topSet.has(r.awarding_agency) ? r.awarding_agency : 'Other';
    row[bucket] = ((row[bucket] as number) ?? 0) + Number(r.total_amount);
  }

  const data = [...byYear.values()].sort((a, b) => (a.fiscal_year as number) - (b.fiscal_year as number));
  return { data, topAgencies };
}

interface StackedTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; dataKey: string }>;
  label?: string | number;
}

function StackedTooltip({ active, payload, label }: StackedTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  const total = payload.reduce((s, p) => s + (Number(p.value) || 0), 0);
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/95 p-3 shadow-xl backdrop-blur-sm max-w-[18rem]">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">FY {label}</p>
      <p className="mt-1 text-sm font-bold text-white">{fmtFullCurrency(total)} total</p>
      <ul className="mt-2 space-y-1">
        {payload
          .slice()
          .reverse()
          .filter((p) => Number(p.value) > 0)
          .map((p) => (
            <li key={p.dataKey} className="flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: p.color }} />
                <span className="text-slate-300 truncate">{p.name}</span>
              </span>
              <span className="text-slate-100 font-mono shrink-0">{fmtCompactCurrency(Number(p.value))}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

function DrilldownView({ rows }: { rows: YearlyByAgencyDatum[] }) {
  const { data, topAgencies } = useMemo(() => buildStackedData(rows), [rows]);
  const stackKeys = [...topAgencies, 'Other'];

  if (data.length === 0) {
    return <p className="text-slate-400 text-sm">No agency-level data available.</p>;
  }

  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 16, right: 16, left: 8, bottom: 8 }}>
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
          <Tooltip content={<StackedTooltip />} cursor={{ fill: '#7c3aed', fillOpacity: 0.05 }} />
          <Legend
            wrapperStyle={{ paddingTop: 8 }}
            iconType="square"
            formatter={(v) => <span className="text-xs text-slate-400">{v}</span>}
          />
          {stackKeys.map((key, idx) => (
            <Bar
              key={key}
              dataKey={key}
              stackId="a"
              fill={key === 'Other' ? OTHER_COLOR : AGENCY_COLORS[idx % AGENCY_COLORS.length]}
              maxBarSize={64}
              radius={idx === stackKeys.length - 1 ? [4, 4, 0, 0] : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- Treemap View (all-time agency mix) ----------

interface TreemapCellProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  name?: string;
  value?: number;
}

function TreemapCell(props: TreemapCellProps) {
  const { x = 0, y = 0, width = 0, height = 0, index = 0, name = '', value = 0 } = props;
  const fill = AGENCY_COLORS[index % AGENCY_COLORS.length];
  // Only render label if cell is big enough
  const showLabel = width > 80 && height > 32;
  const showValue = width > 60 && height > 50;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#0f172a" strokeWidth={2} />
      {showLabel && (
        <text
          x={x + 8}
          y={y + 20}
          fill="#fff"
          fontSize={12}
          fontWeight={600}
          style={{ pointerEvents: 'none' }}
        >
          {name.length > Math.floor(width / 8) ? name.slice(0, Math.floor(width / 8) - 1) + '…' : name}
        </text>
      )}
      {showValue && (
        <text
          x={x + 8}
          y={y + 38}
          fill="rgba(255,255,255,0.85)"
          fontSize={11}
          style={{ pointerEvents: 'none' }}
        >
          {fmtCompactCurrency(Number(value))}
        </text>
      )}
    </g>
  );
}

interface TreemapTooltipPayload {
  payload: { name: string; value: number; awards?: number };
}
interface TreemapTooltipProps {
  active?: boolean;
  payload?: TreemapTooltipPayload[];
}

function TreemapTooltip({ active, payload }: TreemapTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/95 p-3 shadow-xl backdrop-blur-sm">
      <p className="text-sm font-semibold text-white">{d.name}</p>
      <p className="mt-1 text-xs text-slate-300">{fmtFullCurrency(Number(d.value))}</p>
      {typeof d.awards === 'number' && (
        <p className="text-xs text-slate-400">{d.awards.toLocaleString()} awards</p>
      )}
    </div>
  );
}

function TreemapView({ data }: { data: NaicsTreemapDatum[] }) {
  // Show NAICS rather than agencies — even for contractors with extreme
  // single-agency concentration (e.g. Lockheed ~99.99% DoD), the NAICS
  // breakdown reveals genuine line-of-business diversity (aircraft mfg,
  // engineering services, R&D, IT). Agency-mode treemap was returning
  // one giant rectangle that looked broken.
  const treemapData = data.map((d) => ({
    name: d.naics_description || `NAICS ${d.naics_code}`,
    code: d.naics_code,
    value: Number(d.total_amount),
    awards: Number(d.award_count ?? 0),
  }));

  if (treemapData.length === 0) {
    return <p className="text-slate-400 text-sm">No NAICS data for treemap.</p>;
  }

  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer>
        <Treemap
          data={treemapData}
          dataKey="value"
          aspectRatio={4 / 3}
          stroke="#0f172a"
          content={<TreemapCell />}
        >
          <Tooltip content={<TreemapTooltip />} />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- Top-level controls + view router ----------

export function ContractorAnalytics({
  yearly,
  yearlyByAgency,
  treemapNaics,
  currentFiscalYear,
}: Props) {
  const cy = currentFiscalYear ?? new Date().getFullYear();
  const [view, setView] = useState<View>('trend');
  const [period, setPeriod] = useState<Period>('10Y');

  // Period filter applies to time-series views only; treemap is all-time.
  const trendData = useMemo(() => filterByPeriod(yearly, period, cy), [yearly, period, cy]);
  const drilldownData = useMemo(() => filterByPeriod(yearlyByAgency, period, cy), [yearlyByAgency, period, cy]);

  const periods: Period[] = ['1Y', '3Y', '5Y', '10Y', 'ALL'];
  const views: Array<{ id: View; label: string }> = [
    { id: 'trend', label: 'Trend' },
    { id: 'drilldown', label: 'By Agency' },
    { id: 'treemap', label: 'By Industry' },
  ];

  return (
    <div>
      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900 p-1">
          {views.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                view === v.id ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {view !== 'treemap' && (
          <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900 p-1">
            {periods.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-2.5 py-1 text-xs font-mono font-semibold rounded-md transition-colors ${
                  period === p ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Active view */}
      {view === 'trend' && <TrendView data={trendData} currentFiscalYear={cy} />}
      {view === 'drilldown' && <DrilldownView rows={drilldownData} />}
      {view === 'treemap' && <TreemapView data={treemapNaics} />}

      {/* Footer hint */}
      <p className="mt-3 text-xs text-slate-500">
        {view === 'trend' && 'Hover any bar for YoY change + award count. Current fiscal year shown at reduced opacity (partial year).'}
        {view === 'drilldown' && 'Stacked by top 7 awarding agencies. "Other" rolls up the remainder. Hover for breakdown.'}
        {view === 'treemap' && 'All-time NAICS (line-of-business) mix. Rectangle area is proportional to total obligated dollars.'}
      </p>
    </div>
  );
}
