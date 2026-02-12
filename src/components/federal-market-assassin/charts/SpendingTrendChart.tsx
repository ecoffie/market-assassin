'use client';

import { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  Legend,
  BarChart,
  Bar,
  Cell,
} from 'recharts';
import type { AgencyBudgetData } from '@/types/federal-market-assassin';

interface ForecastData {
  agency: string;
  quarter: string;
  estimatedValue: number;
  solicitationDate?: string;
  description?: string;
}

interface AgencyData {
  contractingOffice: string;
  parentAgency: string;
  spending: number;
  contractCount: number;
}

interface SpendingTrendChartProps {
  forecasts?: ForecastData[];
  agencies?: AgencyData[];
  budgetComparison?: AgencyBudgetData[];
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

const TREND_COLORS: Record<string, string> = {
  surging: '#22C55E',
  growing: '#4ADE80',
  stable: '#F59E0B',
  declining: '#F97316',
  cut: '#EF4444',
};

const formatCurrency = (value: number): string => {
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
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

export default function SpendingTrendChart({ forecasts = [], agencies = [], budgetComparison }: SpendingTrendChartProps) {
  const [chartType, setChartType] = useState<'line' | 'area'>('area');
  const [viewMode, setViewMode] = useState<'quarterly' | 'cumulative'>('quarterly');

  // If budget comparison data is available, build a bar chart dataset
  const budgetBarData = useMemo(() => {
    if (!budgetComparison || budgetComparison.length === 0) return null;

    return budgetComparison.map(d => {
      let shortName = d.agency
        .replace('Department of the ', '')
        .replace('Department of ', '')
        .replace('National Aeronautics and Space Administration', 'NASA')
        .replace('Environmental Protection Agency', 'EPA')
        .replace('General Services Administration', 'GSA');
      if (shortName.length > 18) shortName = shortName.substring(0, 16) + '...';

      return {
        name: shortName,
        fullName: d.agency,
        fy2025: d.fy2025.budgetAuthority,
        fy2026: d.fy2026.budgetAuthority,
        trend: d.change.trend,
        changePercent: ((d.change.percent - 1) * 100).toFixed(1),
      };
    });
  }, [budgetComparison]);

  // Generate quarterly trend data from forecasts
  const quarterlyData = useMemo(() => {
    const quarters = ['Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025', 'Q1 2026', 'Q2 2026'];

    // If we have forecast data, use it
    if (forecasts.length > 0) {
      const quarterlyTotals = quarters.map((quarter) => {
        const quarterForecasts = forecasts.filter((f) => f.quarter === quarter);
        const total = quarterForecasts.reduce((sum, f) => sum + f.estimatedValue, 0);
        return {
          quarter,
          spending: total,
          opportunities: quarterForecasts.length,
        };
      });
      return quarterlyTotals;
    }

    // If we have budget comparison data, show FY annual comparison as bars instead of simulated quarterly
    if (budgetBarData) {
      return []; // quarterly view not applicable when showing budget comparison
    }

    // Otherwise, generate trend based on agency spending (no simulated multipliers)
    if (agencies.length > 0) {
      const totalSpending = agencies.reduce((sum, a) => sum + a.spending, 0);
      const avgQuarterly = totalSpending / 4;

      return quarters.map((quarter) => ({
        quarter,
        spending: Math.round(avgQuarterly),
        opportunities: agencies.length,
      }));
    }

    return [];
  }, [forecasts, agencies, budgetBarData]);

  // Calculate cumulative data
  const cumulativeData = useMemo(() => {
    let cumulative = 0;
    return quarterlyData.map((d) => {
      cumulative += d.spending;
      return {
        ...d,
        cumulative,
      };
    });
  }, [quarterlyData]);

  const chartData = viewMode === 'cumulative' ? cumulativeData : quarterlyData;
  const dataKey = viewMode === 'cumulative' ? 'cumulative' : 'spending';

  const totalForecast = useMemo(() => {
    return quarterlyData.reduce((sum, d) => sum + d.spending, 0);
  }, [quarterlyData]);

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string }>; label?: string }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl">
          <p className="text-white font-semibold text-sm mb-2">{label}</p>
          {payload.map((entry, index) => (
            <p key={index} className="text-blue-400 text-sm">
              {entry.name === 'cumulative' ? 'Cumulative' : 'Spending'}: {formatFullCurrency(entry.value)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // If we have budget comparison data and no quarterly data, show budget bars
  if (budgetBarData && budgetBarData.length > 0 && quarterlyData.length === 0) {
    const BudgetTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; dataKey: string }>; label?: string }) => {
      if (active && payload && payload.length) {
        const item = budgetBarData.find(d => d.name === label);
        return (
          <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl max-w-xs">
            <p className="text-white font-semibold text-sm mb-2">{item?.fullName || label}</p>
            {payload.map((entry, index) => (
              <p key={index} className={`text-sm ${entry.dataKey === 'fy2025' ? 'text-slate-400' : 'text-blue-400'}`}>
                {entry.dataKey === 'fy2025' ? 'FY2025' : 'FY2026'}: {formatFullCurrency(entry.value)}
              </p>
            ))}
            {item && (
              <p className={`text-sm mt-1 ${Number(item.changePercent) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {Number(item.changePercent) >= 0 ? '+' : ''}{item.changePercent}%
              </p>
            )}
          </div>
        );
      }
      return null;
    };

    return (
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="mb-6">
          <h3 className="text-xl font-bold text-white">Budget Authority: FY2025 vs FY2026</h3>
          <p className="text-slate-400 text-sm mt-1">Real budget data from USASpending.gov</p>
        </div>
        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={budgetBarData} margin={{ top: 10, right: 30, left: 10, bottom: 60 }} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} angle={-35} textAnchor="end" height={80} interval={0} />
              <YAxis tickFormatter={formatCurrency} stroke="#9CA3AF" fontSize={12} />
              <Tooltip content={<BudgetTooltip />} />
              <Legend formatter={(value: string) => <span className="text-slate-300 text-sm">{value === 'fy2025' ? 'FY2025' : 'FY2026'}</span>} />
              <Bar dataKey="fy2025" name="fy2025" fill="#64748B" radius={[2, 2, 0, 0]} />
              <Bar dataKey="fy2026" name="fy2026" radius={[2, 2, 0, 0]}>
                {budgetBarData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={TREND_COLORS[entry.trend] || '#3B82F6'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  if (quarterlyData.length === 0) {
    return (
      <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-400">
        No trend data available
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h3 className="text-xl font-bold text-white">Spending Trends & Forecast</h3>
          <p className="text-slate-400 text-sm mt-1">
            Projected Total: {formatFullCurrency(totalForecast)}
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as 'quarterly' | 'cumulative')}
            className="bg-slate-700 text-white text-sm rounded-lg px-3 py-2 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="quarterly">Quarterly</option>
            <option value="cumulative">Cumulative</option>
          </select>
          <div className="flex rounded-lg overflow-hidden border border-slate-600">
            <button
              onClick={() => setChartType('area')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                chartType === 'area'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              Area
            </button>
            <button
              onClick={() => setChartType('line')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                chartType === 'line'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              Line
            </button>
          </div>
        </div>
      </div>

      <div className="h-[350px]">
        {chartType === 'area' ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorSpending" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="quarter" stroke="#9CA3AF" fontSize={12} />
              <YAxis tickFormatter={formatCurrency} stroke="#9CA3AF" fontSize={12} />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke="#3B82F6"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorSpending)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="quarter" stroke="#9CA3AF" fontSize={12} />
              <YAxis tickFormatter={formatCurrency} stroke="#9CA3AF" fontSize={12} />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey={dataKey}
                stroke="#3B82F6"
                strokeWidth={3}
                dot={{ fill: '#3B82F6', strokeWidth: 2, r: 5 }}
                activeDot={{ r: 8, fill: '#60A5FA' }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Q4 Spending Alert */}
      <div className="mt-4 bg-amber-900/30 border border-amber-600/50 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">💡</span>
          <div>
            <p className="text-amber-200 font-semibold text-sm">Q4 End-of-Year Spending Peak</p>
            <p className="text-amber-100/70 text-xs mt-1">
              Federal agencies typically increase spending in Q4 (Oct-Dec) to utilize remaining budget allocations.
              This is an optimal time to pursue quick-turn contracts.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
