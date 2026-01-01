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
  Cell,
  Treemap,
} from 'recharts';

interface AgencyData {
  contractingOffice: string;
  subAgency: string;
  parentAgency: string;
  spending: number;
  contractCount: number;
  location?: string;
}

interface GeographicDistributionChartProps {
  agencies: AgencyData[];
}

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'Washington D.C.', PR: 'Puerto Rico', VI: 'Virgin Islands', GU: 'Guam',
};

const REGION_COLORS: Record<string, string> = {
  Northeast: '#3B82F6',
  Southeast: '#10B981',
  Midwest: '#F59E0B',
  Southwest: '#EF4444',
  West: '#8B5CF6',
  'Pacific/Territories': '#EC4899',
  'Washington D.C.': '#06B6D4',
};

const STATE_REGIONS: Record<string, string> = {
  ME: 'Northeast', NH: 'Northeast', VT: 'Northeast', MA: 'Northeast', RI: 'Northeast',
  CT: 'Northeast', NY: 'Northeast', NJ: 'Northeast', PA: 'Northeast',
  DE: 'Southeast', MD: 'Southeast', VA: 'Southeast', WV: 'Southeast', NC: 'Southeast',
  SC: 'Southeast', GA: 'Southeast', FL: 'Southeast', AL: 'Southeast', MS: 'Southeast',
  TN: 'Southeast', KY: 'Southeast',
  OH: 'Midwest', IN: 'Midwest', IL: 'Midwest', MI: 'Midwest', WI: 'Midwest',
  MN: 'Midwest', IA: 'Midwest', MO: 'Midwest', ND: 'Midwest', SD: 'Midwest',
  NE: 'Midwest', KS: 'Midwest',
  TX: 'Southwest', OK: 'Southwest', NM: 'Southwest', AZ: 'Southwest', AR: 'Southwest', LA: 'Southwest',
  MT: 'West', WY: 'West', CO: 'West', UT: 'West', ID: 'West', NV: 'West',
  WA: 'West', OR: 'West', CA: 'West',
  AK: 'Pacific/Territories', HI: 'Pacific/Territories', PR: 'Pacific/Territories',
  VI: 'Pacific/Territories', GU: 'Pacific/Territories',
  DC: 'Washington D.C.',
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

export default function GeographicDistributionChart({ agencies }: GeographicDistributionChartProps) {
  const [viewMode, setViewMode] = useState<'state' | 'region'>('state');

  const stateData = useMemo(() => {
    const stateSpending: Record<string, { spending: number; contracts: number; agencies: number }> = {};

    agencies.forEach((agency) => {
      const state = agency.location || 'Unknown';
      if (!stateSpending[state]) {
        stateSpending[state] = { spending: 0, contracts: 0, agencies: 0 };
      }
      stateSpending[state].spending += agency.spending;
      stateSpending[state].contracts += agency.contractCount;
      stateSpending[state].agencies += 1;
    });

    return Object.entries(stateSpending)
      .filter(([state]) => state !== 'Unknown')
      .sort((a, b) => b[1].spending - a[1].spending)
      .slice(0, 15)
      .map(([state, data]) => ({
        state,
        name: STATE_NAMES[state] || state,
        spending: data.spending,
        contracts: data.contracts,
        agencies: data.agencies,
        region: STATE_REGIONS[state] || 'Other',
      }));
  }, [agencies]);

  const regionData = useMemo(() => {
    const regionSpending: Record<string, { spending: number; contracts: number; states: Set<string> }> = {};

    agencies.forEach((agency) => {
      const state = agency.location || 'Unknown';
      const region = STATE_REGIONS[state] || 'Other';
      if (!regionSpending[region]) {
        regionSpending[region] = { spending: 0, contracts: 0, states: new Set() };
      }
      regionSpending[region].spending += agency.spending;
      regionSpending[region].contracts += agency.contractCount;
      regionSpending[region].states.add(state);
    });

    return Object.entries(regionSpending)
      .filter(([region]) => region !== 'Other')
      .sort((a, b) => b[1].spending - a[1].spending)
      .map(([region, data]) => ({
        name: region,
        spending: data.spending,
        contracts: data.contracts,
        states: data.states.size,
        color: REGION_COLORS[region] || '#6B7280',
      }));
  }, [agencies]);

  const totalSpending = useMemo(() => {
    return agencies.reduce((sum, a) => sum + a.spending, 0);
  }, [agencies]);

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; spending: number; contracts: number; agencies?: number; states?: number; region?: string } }> }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl">
          <p className="text-white font-semibold text-sm mb-1">{data.name}</p>
          {data.region && <p className="text-slate-400 text-xs mb-2">Region: {data.region}</p>}
          <p className="text-blue-400 text-sm">Spending: {formatFullCurrency(data.spending)}</p>
          <p className="text-green-400 text-sm">Contracts: {data.contracts.toLocaleString()}</p>
          {data.agencies && <p className="text-amber-400 text-sm">Agencies: {data.agencies}</p>}
          {data.states && <p className="text-purple-400 text-sm">States: {data.states}</p>}
        </div>
      );
    }
    return null;
  };

  if (agencies.length === 0) {
    return (
      <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-400">
        No geographic data available
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h3 className="text-xl font-bold text-white">Geographic Distribution</h3>
          <p className="text-slate-400 text-sm mt-1">
            Contract spending by location • Total: {formatFullCurrency(totalSpending)}
          </p>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-slate-600">
          <button
            onClick={() => setViewMode('state')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === 'state'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            By State
          </button>
          <button
            onClick={() => setViewMode('region')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === 'region'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            By Region
          </button>
        </div>
      </div>

      <div className="h-[400px]">
        {viewMode === 'state' ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={stateData}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 60, bottom: 5 }}
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
                width={120}
                stroke="#9CA3AF"
                fontSize={11}
                tick={{ fill: '#9CA3AF' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="spending" radius={[0, 4, 4, 0]} maxBarSize={25}>
                {stateData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={REGION_COLORS[entry.region] || '#3B82F6'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={regionData}
              margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="name"
                stroke="#9CA3AF"
                fontSize={11}
                tick={{ fill: '#9CA3AF' }}
                angle={-30}
                textAnchor="end"
                height={80}
              />
              <YAxis
                tickFormatter={formatCurrency}
                stroke="#9CA3AF"
                fontSize={12}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="spending" radius={[4, 4, 0, 0]} maxBarSize={60}>
                {regionData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Region Legend */}
      <div className="mt-4 flex flex-wrap gap-3 justify-center">
        {Object.entries(REGION_COLORS).slice(0, 6).map(([region, color]) => (
          <div key={region} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-slate-400 text-xs">{region}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
