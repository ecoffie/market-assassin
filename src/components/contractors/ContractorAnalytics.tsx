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
import { MP_COLORS } from '@/lib/public-site/tokens';
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

/** Mix a token colour toward white; `share` is the fraction of the token kept. */
function tint(hex: string, share: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * share + 255 * (1 - share));
  return `#${[16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('')}`;
}

// Categorical ramp derived from the public tokens: navy tints, then warm neutrals. Status and
// accent colours stay out so a chart category never reads as a warning or an editorial mark.
const AGENCY_COLORS = [
  MP_COLORS.navy,
  tint(MP_COLORS.navy, 0.72),
  tint(MP_COLORS.navy, 0.48),
  tint(MP_COLORS.navy, 0.28),
  MP_COLORS.body,
  MP_COLORS.muted,
  MP_COLORS.faint,
  tint(MP_COLORS.body, 0.35),
];
const OTHER_COLOR = MP_COLORS.line;

/** Ink or white, whichever reads on the given fill. */
function labelOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 150 ? MP_COLORS.ink : MP_COLORS.surface;
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
    <div className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-3 backdrop-blur-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-(--mp-muted)">
        FY {d.fiscal_year}
        {d.is_partial && <span className="ml-2 text-(--mp-warn)">(YTD)</span>}
      </p>
      <p className="mt-1 text-base font-bold text-(--mp-ink)">{fmtFullCurrency(d.total_obligated)}</p>
      <p className="text-xs text-(--mp-muted)">{d.award_count.toLocaleString()} awards</p>
      {yoyText && (
        <p className={`mt-1 text-xs font-semibold ${(yoy ?? 0) >= 0 ? 'text-(--mp-ok)' : 'text-(--mp-crit)'}`}>
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
          <CartesianGrid stroke={MP_COLORS.hair} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="fiscal_year"
            tick={{ fill: MP_COLORS.muted, fontSize: 12 }}
            tickFormatter={(v) => `FY${String(v).slice(-2)}`}
            axisLine={{ stroke: MP_COLORS.line }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: MP_COLORS.muted, fontSize: 11 }}
            tickFormatter={(v) => fmtCompactCurrency(Number(v))}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip content={<TrendTooltip />} cursor={{ fill: MP_COLORS.navy, fillOpacity: 0.08 }} />
          <Bar dataKey="total_obligated" radius={[4, 4, 0, 0]} maxBarSize={64}>
            {enriched.map((entry, idx) => (
              <Cell key={`c-${idx}`} fill={MP_COLORS.navy} fillOpacity={entry.is_partial ? 0.5 : 1} />
            ))}
            <LabelList
              dataKey="total_obligated"
              position="top"
              formatter={(v) => fmtCompactCurrency(Number(v ?? 0))}
              fill={MP_COLORS.body}
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
    <div className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-3 backdrop-blur-sm max-w-[18rem]">
      <p className="text-xs font-semibold uppercase tracking-wider text-(--mp-muted)">FY {label}</p>
      <p className="mt-1 text-sm font-bold text-(--mp-ink)">{fmtFullCurrency(total)} total</p>
      <ul className="mt-2 space-y-1">
        {payload
          .slice()
          .reverse()
          .filter((p) => Number(p.value) > 0)
          .map((p) => (
            <li key={p.dataKey} className="flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: p.color }} />
                <span className="text-(--mp-body) truncate">{p.name}</span>
              </span>
              <span className="text-(--mp-ink) font-(family-name:--mp-font-mono) shrink-0">{fmtCompactCurrency(Number(p.value))}</span>
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
    return <p className="text-(--mp-muted) text-sm">No agency-level data available.</p>;
  }

  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 16, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid stroke={MP_COLORS.hair} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="fiscal_year"
            tick={{ fill: MP_COLORS.muted, fontSize: 12 }}
            tickFormatter={(v) => `FY${String(v).slice(-2)}`}
            axisLine={{ stroke: MP_COLORS.line }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: MP_COLORS.muted, fontSize: 11 }}
            tickFormatter={(v) => fmtCompactCurrency(Number(v))}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip content={<StackedTooltip />} cursor={{ fill: MP_COLORS.navy, fillOpacity: 0.05 }} />
          <Legend
            wrapperStyle={{ paddingTop: 8 }}
            iconType="square"
            formatter={(v) => <span className="text-xs text-(--mp-muted)">{v}</span>}
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
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke={MP_COLORS.surface} strokeWidth={2} />
      {showLabel && (
        <text
          x={x + 8}
          y={y + 20}
          fill={labelOn(fill)}
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
          fill={labelOn(fill)}
          fillOpacity={0.85}
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
    <div className="rounded-lg border border-(--mp-line) bg-(--mp-surface) p-3 backdrop-blur-sm">
      <p className="text-sm font-semibold text-(--mp-ink)">{d.name}</p>
      <p className="mt-1 text-xs text-(--mp-body)">{fmtFullCurrency(Number(d.value))}</p>
      {typeof d.awards === 'number' && (
        <p className="text-xs text-(--mp-muted)">{d.awards.toLocaleString()} awards</p>
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
    return <p className="text-(--mp-muted) text-sm">No NAICS data for treemap.</p>;
  }

  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer>
        <Treemap
          data={treemapData}
          dataKey="value"
          aspectRatio={4 / 3}
          stroke={MP_COLORS.surface}
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
        <div className="inline-flex rounded-lg border border-(--mp-line) bg-(--mp-surface) p-1">
          {views.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                view === v.id ? 'bg-(--mp-navy) text-white' : 'text-(--mp-muted) hover:text-(--mp-ink)'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {view !== 'treemap' && (
          <div className="inline-flex rounded-lg border border-(--mp-line) bg-(--mp-surface) p-1">
            {periods.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-2.5 py-1 text-xs font-(family-name:--mp-font-mono) font-semibold rounded-md transition-colors ${
                  period === p ? 'bg-(--mp-wash) text-(--mp-ink)' : 'text-(--mp-muted) hover:text-(--mp-body)'
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
      <p className="mt-3 text-xs text-(--mp-muted)">
        {view === 'trend' && 'Hover any bar for YoY change + award count. Current fiscal year shown at reduced opacity (partial year).'}
        {view === 'drilldown' && 'Stacked by top 7 awarding agencies. "Other" rolls up the remainder. Hover for breakdown.'}
        {view === 'treemap' && 'All-time NAICS (line-of-business) mix. Rectangle area is proportional to total obligated dollars.'}
      </p>
    </div>
  );
}
