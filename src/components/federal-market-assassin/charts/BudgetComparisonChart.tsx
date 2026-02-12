'use client';

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from 'recharts';
import type { AgencyBudgetData } from '@/types/federal-market-assassin';

interface BudgetComparisonChartProps {
  budgetData: AgencyBudgetData[];
  maxAgencies?: number;
}

const formatCurrency = (value: number): string => {
  if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(1)}T`;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
};

const formatFullCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

const TREND_COLORS: Record<string, string> = {
  surging: '#22C55E',   // green-500
  growing: '#4ADE80',   // green-400
  stable: '#F59E0B',    // amber-500
  declining: '#F97316',  // orange-500
  cut: '#EF4444',       // red-500
};

export default function BudgetComparisonChart({ budgetData, maxAgencies = 12 }: BudgetComparisonChartProps) {
  const chartData = useMemo(() => {
    return budgetData
      .slice(0, maxAgencies)
      .map(d => {
        // Shorten long agency names for chart labels
        let shortName = d.agency
          .replace('Department of the ', '')
          .replace('Department of ', '')
          .replace('National Aeronautics and Space Administration', 'NASA')
          .replace('Environmental Protection Agency', 'EPA')
          .replace('General Services Administration', 'GSA')
          .replace('Small Business Administration', 'SBA')
          .replace('Social Security Administration', 'SSA');

        if (shortName.length > 20) {
          shortName = shortName.substring(0, 18) + '...';
        }

        return {
          name: shortName,
          fullName: d.agency,
          fy2025: d.fy2025.budgetAuthority,
          fy2026: d.fy2026.budgetAuthority,
          trend: d.change.trend,
          changePercent: ((d.change.percent - 1) * 100).toFixed(1),
          changeAmount: d.change.amount,
        };
      });
  }, [budgetData, maxAgencies]);

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; dataKey: string }>; label?: string }) => {
    if (active && payload && payload.length) {
      const item = chartData.find(d => d.name === label);
      return (
        <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl max-w-xs">
          <p className="text-white font-semibold text-sm mb-2">{item?.fullName || label}</p>
          {payload.map((entry, index) => (
            <p key={index} className={`text-sm ${entry.dataKey === 'fy2025' ? 'text-slate-400' : 'text-blue-400'}`}>
              {entry.dataKey === 'fy2025' ? 'FY2025' : 'FY2026'}: {formatFullCurrency(entry.value)}
            </p>
          ))}
          {item && (
            <div className="mt-2 pt-2 border-t border-slate-600">
              <p className={`text-sm font-medium ${
                item.trend === 'surging' || item.trend === 'growing' ? 'text-green-400' :
                item.trend === 'stable' ? 'text-amber-400' : 'text-red-400'
              }`}>
                {Number(item.changePercent) >= 0 ? '+' : ''}{item.changePercent}% ({formatCurrency(item.changeAmount)})
                {item.trend === 'surging' ? ' ▲▲' : item.trend === 'growing' ? ' ▲' :
                 item.trend === 'stable' ? ' ─' : item.trend === 'declining' ? ' ▼' : ' ▼▼'}
              </p>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  if (chartData.length === 0) {
    return (
      <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-400">
        No budget comparison data available
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
      <div className="mb-6">
        <h3 className="text-xl font-bold text-white">FY2025 vs FY2026 Budget Authority</h3>
        <p className="text-slate-400 text-sm mt-1">
          Bar color reflects FY2026 budget trend
        </p>
      </div>

      <div className="h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 10, right: 30, left: 10, bottom: 60 }}
            barGap={2}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="name"
              stroke="#9CA3AF"
              fontSize={11}
              angle={-35}
              textAnchor="end"
              height={80}
              interval={0}
            />
            <YAxis tickFormatter={formatCurrency} stroke="#9CA3AF" fontSize={12} />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ paddingTop: '10px' }}
              formatter={(value: string) => (
                <span className="text-slate-300 text-sm">
                  {value === 'fy2025' ? 'FY2025' : 'FY2026'}
                </span>
              )}
            />
            <Bar dataKey="fy2025" name="fy2025" fill="#64748B" radius={[2, 2, 0, 0]} />
            <Bar dataKey="fy2026" name="fy2026" radius={[2, 2, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={TREND_COLORS[entry.trend] || '#3B82F6'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
