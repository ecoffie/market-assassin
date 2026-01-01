'use client';

import { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  PieLabelRenderProps,
} from 'recharts';

interface AgencyData {
  contractingOffice: string;
  subAgency: string;
  parentAgency: string;
  spending: number;
  contractCount: number;
  location?: string;
}

interface AgencySpendingChartProps {
  agencies: AgencyData[];
}

const COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
  '#14B8A6', '#A855F7', '#F43F5E', '#22C55E', '#EAB308',
];

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

export default function AgencySpendingChart({ agencies }: AgencySpendingChartProps) {
  const [chartType, setChartType] = useState<'bar' | 'pie'>('bar');
  const [groupBy, setGroupBy] = useState<'office' | 'parent'>('office');

  const chartData = useMemo(() => {
    if (groupBy === 'office') {
      return agencies
        .slice(0, 15)
        .map((agency) => ({
          name: agency.contractingOffice.length > 25
            ? agency.contractingOffice.substring(0, 25) + '...'
            : agency.contractingOffice,
          fullName: agency.contractingOffice,
          spending: agency.spending,
          contracts: agency.contractCount,
        }));
    } else {
      // Group by parent agency
      const grouped = agencies.reduce((acc, agency) => {
        const parent = agency.parentAgency || 'Other';
        if (!acc[parent]) {
          acc[parent] = { spending: 0, contracts: 0 };
        }
        acc[parent].spending += agency.spending;
        acc[parent].contracts += agency.contractCount;
        return acc;
      }, {} as Record<string, { spending: number; contracts: number }>);

      return Object.entries(grouped)
        .sort((a, b) => b[1].spending - a[1].spending)
        .slice(0, 10)
        .map(([name, data]) => ({
          name: name.length > 30 ? name.substring(0, 30) + '...' : name,
          fullName: name,
          spending: data.spending,
          contracts: data.contracts,
        }));
    }
  }, [agencies, groupBy]);

  const totalSpending = useMemo(() => {
    return agencies.reduce((sum, a) => sum + a.spending, 0);
  }, [agencies]);

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: { fullName: string; spending: number; contracts: number } }> }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl">
          <p className="text-white font-semibold text-sm mb-1">{data.fullName}</p>
          <p className="text-blue-400 text-sm">Spending: {formatFullCurrency(data.spending)}</p>
          <p className="text-green-400 text-sm">Contracts: {data.contracts.toLocaleString()}</p>
        </div>
      );
    }
    return null;
  };

  if (agencies.length === 0) {
    return (
      <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-400">
        No agency data available for chart
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h3 className="text-xl font-bold text-white">Agency Spending Analysis</h3>
          <p className="text-slate-400 text-sm mt-1">
            Total: {formatFullCurrency(totalSpending)} across {agencies.length} agencies
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as 'office' | 'parent')}
            className="bg-slate-700 text-white text-sm rounded-lg px-3 py-2 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="office">By Office</option>
            <option value="parent">By Parent Agency</option>
          </select>
          <div className="flex rounded-lg overflow-hidden border border-slate-600">
            <button
              onClick={() => setChartType('bar')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                chartType === 'bar'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              Bar
            </button>
            <button
              onClick={() => setChartType('pie')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                chartType === 'pie'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              Pie
            </button>
          </div>
        </div>
      </div>

      <div className="h-[400px]">
        {chartType === 'bar' ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                type="number"
                tickFormatter={formatCurrency}
                stroke="#9CA3AF"
                fontSize={12}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={150}
                stroke="#9CA3AF"
                fontSize={11}
                tick={{ fill: '#9CA3AF' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar
                dataKey="spending"
                fill="#3B82F6"
                radius={[0, 4, 4, 0]}
                maxBarSize={30}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                labelLine={false}
                outerRadius={140}
                fill="#8884d8"
                dataKey="spending"
                label={(props: PieLabelRenderProps) => {
                  const { name, percent } = props;
                  const nameStr = String(name ?? '');
                  const pct = Number(percent ?? 0);
                  return pct > 0.05 ? `${nameStr.substring(0, 15)}${nameStr.length > 15 ? '...' : ''} (${(pct * 100).toFixed(0)}%)` : '';
                }}
              >
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend
                formatter={(value) => <span className="text-slate-300 text-xs">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
