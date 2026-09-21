'use client';

import { useState } from 'react';
import { ComprehensiveReport } from '@/types/federal-market-assassin';

interface PricingIntelTabProps {
  report: ComprehensiveReport;
}

function formatRate(rate: number): string {
  return `$${rate.toFixed(2)}`;
}

export default function PricingIntelTab({ report }: PricingIntelTabProps) {
  const [ptwRate, setPtwRate] = useState('');
  const data = report.pricingIntel;

  if (!data) {
    return (
      <div className="p-8 text-center">
        <p className="text-slate-400 text-lg">Pricing intelligence not available for this NAICS code.</p>
        <p className="text-slate-500 text-sm mt-2">GSA CALC+ data may not cover this industry category.</p>
      </div>
    );
  }

  const { priceToWinGuidance, businessSizeComparison, laborCategories, rateDistribution, topVendors } = data;

  // Price-to-Win calculation
  const userRate = parseFloat(ptwRate);
  const allPrices = laborCategories.flatMap(c =>
    Array(c.recordCount).fill(0).map(() => c.median)
  ).sort((a, b) => a - b);

  let ptwPercentile = 0;
  let ptwVerdict = '';
  let ptwColor = 'text-slate-400';

  if (userRate > 0 && allPrices.length > 0) {
    const below = allPrices.filter(p => p <= userRate).length;
    ptwPercentile = Math.round((below / allPrices.length) * 100);

    if (ptwPercentile <= 25) {
      ptwVerdict = 'Very aggressive — strong on price, may need to justify quality and past performance.';
      ptwColor = 'text-green-400';
    } else if (ptwPercentile <= 50) {
      ptwVerdict = 'Competitive — good balance of price and value. Strong position for LPTA evaluations.';
      ptwColor = 'text-blue-400';
    } else if (ptwPercentile <= 75) {
      ptwVerdict = 'Above market — viable for best-value procurements if you demonstrate superior capability.';
      ptwColor = 'text-amber-400';
    } else {
      ptwVerdict = 'Premium pricing — only competitive if you have unique qualifications or incumbent advantage.';
      ptwColor = 'text-red-400';
    }
  }

  // Find max count for bar chart scaling
  const maxDistCount = Math.max(...rateDistribution.map(b => b.count), 1);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-2xl font-bold text-white">Pricing Intelligence</h2>
            <p className="text-slate-400 mt-1">
              GSA CALC+ labor rates for <span className="text-blue-400 font-semibold">{data.naicsDescription}</span> (NAICS {data.naicsCode})
            </p>
          </div>
          <div className="text-right text-sm text-slate-500">
            <p>{data.totalRecordsAnalyzed.toLocaleString()} rate records analyzed</p>
            <p>Source: GSA CALC+ (MAS contracts)</p>
          </div>
        </div>
      </div>

      {/* Price-to-Win Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-green-900/40 to-green-800/20 border border-green-700/50 rounded-xl p-5">
          <p className="text-green-400 text-sm font-semibold uppercase tracking-wide">Aggressive</p>
          <p className="text-3xl font-bold text-white mt-1">{formatRate(priceToWinGuidance.aggressiveRate)}<span className="text-lg text-slate-400">/hr</span></p>
          <p className="text-green-300/70 text-xs mt-2">25th percentile — undercuts most competitors</p>
        </div>
        <div className="bg-gradient-to-br from-blue-900/40 to-blue-800/20 border border-blue-700/50 rounded-xl p-5">
          <p className="text-blue-400 text-sm font-semibold uppercase tracking-wide">Competitive</p>
          <p className="text-3xl font-bold text-white mt-1">{formatRate(priceToWinGuidance.competitiveRate)}<span className="text-lg text-slate-400">/hr</span></p>
          <p className="text-blue-300/70 text-xs mt-2">Median market rate — balanced positioning</p>
        </div>
        <div className="bg-gradient-to-br from-amber-900/40 to-amber-800/20 border border-amber-700/50 rounded-xl p-5">
          <p className="text-amber-400 text-sm font-semibold uppercase tracking-wide">Premium</p>
          <p className="text-3xl font-bold text-white mt-1">{formatRate(priceToWinGuidance.premiumRate)}<span className="text-lg text-slate-400">/hr</span></p>
          <p className="text-amber-300/70 text-xs mt-2">75th percentile — best-value procurements</p>
        </div>
      </div>

      {/* Price-to-Win Calculator */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h3 className="text-lg font-bold text-white mb-4">Price-to-Win Calculator</h3>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Your proposed rate:</span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
              <input
                type="number"
                value={ptwRate}
                onChange={(e) => setPtwRate(e.target.value)}
                placeholder="0.00"
                className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 pl-7 text-white w-32 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <span className="text-slate-400">/hr</span>
          </div>
          {userRate > 0 && (
            <div className="flex-1 min-w-[200px]">
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-slate-700 rounded-full h-3 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      ptwPercentile <= 25 ? 'bg-green-500' :
                      ptwPercentile <= 50 ? 'bg-blue-500' :
                      ptwPercentile <= 75 ? 'bg-amber-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${ptwPercentile}%` }}
                  />
                </div>
                <span className="text-white font-bold text-sm w-12">{ptwPercentile}th</span>
              </div>
              <p className={`text-sm mt-2 ${ptwColor}`}>{ptwVerdict}</p>
            </div>
          )}
        </div>
      </div>

      {/* Small Business vs Large */}
      {businessSizeComparison.smallBusiness.count > 0 && businessSizeComparison.largeBusiness.count > 0 && (
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h3 className="text-lg font-bold text-white mb-4">Small Business vs Large Business Rates</h3>
          <div className="grid grid-cols-2 gap-6">
            <div className="text-center">
              <p className="text-sm text-slate-400 mb-1">Small Business</p>
              <p className="text-2xl font-bold text-green-400">{formatRate(businessSizeComparison.smallBusiness.median)}/hr</p>
              <p className="text-xs text-slate-500 mt-1">median ({businessSizeComparison.smallBusiness.count} records)</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-slate-400 mb-1">Large Business</p>
              <p className="text-2xl font-bold text-blue-400">{formatRate(businessSizeComparison.largeBusiness.median)}/hr</p>
              <p className="text-xs text-slate-500 mt-1">median ({businessSizeComparison.largeBusiness.count} records)</p>
            </div>
          </div>
          {businessSizeComparison.gapPercent !== 0 && (
            <p className="text-center text-sm text-slate-400 mt-4">
              Small businesses price <span className="font-semibold text-white">{Math.abs(businessSizeComparison.gapPercent).toFixed(1)}%</span>
              {businessSizeComparison.gapPercent > 0 ? ' lower' : ' higher'} than large businesses on average
            </p>
          )}
        </div>
      )}

      {/* Rate Distribution Chart */}
      {rateDistribution.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h3 className="text-lg font-bold text-white mb-4">Rate Distribution</h3>
          <div className="space-y-2">
            {rateDistribution.map((bucket) => (
              <div key={bucket.range} className="flex items-center gap-3">
                <span className="text-xs text-slate-400 w-20 text-right font-mono">{bucket.range}</span>
                <div className="flex-1 bg-slate-700 rounded-full h-5 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all"
                    style={{ width: `${(bucket.count / maxDistCount) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-slate-400 w-10">{bucket.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Labor Categories Table */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-700">
          <h3 className="text-lg font-bold text-white">Labor Category Rates</h3>
          <p className="text-sm text-slate-400">Ceiling rates from GSA MAS contracts — sorted by data volume</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-700/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase">Labor Category</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-300 uppercase">Records</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-300 uppercase">Min</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-300 uppercase">25th</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-300 uppercase">Median</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-300 uppercase">75th</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-300 uppercase">Max</th>
                {laborCategories.some(c => c.nextYearMedian) && (
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-300 uppercase">Next Yr</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {laborCategories.map((cat, idx) => (
                <tr key={idx} className="hover:bg-slate-700/30">
                  <td className="px-4 py-3 text-sm text-white max-w-xs truncate" title={cat.category}>{cat.category}</td>
                  <td className="px-4 py-3 text-sm text-slate-400 text-right">{cat.recordCount}</td>
                  <td className="px-4 py-3 text-sm text-slate-400 text-right font-mono">{formatRate(cat.min)}</td>
                  <td className="px-4 py-3 text-sm text-green-400 text-right font-mono">{formatRate(cat.percentile25)}</td>
                  <td className="px-4 py-3 text-sm text-blue-400 text-right font-mono font-bold">{formatRate(cat.median)}</td>
                  <td className="px-4 py-3 text-sm text-amber-400 text-right font-mono">{formatRate(cat.percentile75)}</td>
                  <td className="px-4 py-3 text-sm text-slate-400 text-right font-mono">{formatRate(cat.max)}</td>
                  {laborCategories.some(c => c.nextYearMedian) && (
                    <td className="px-4 py-3 text-sm text-purple-400 text-right font-mono">
                      {cat.nextYearMedian ? formatRate(cat.nextYearMedian) : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Vendors */}
      {topVendors.length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="p-4 border-b border-slate-700">
            <h3 className="text-lg font-bold text-white">Top Vendors by Rate Volume</h3>
            <p className="text-sm text-slate-400">Companies with the most CALC+ rate entries in your category</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-700/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase">Vendor</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-300 uppercase">Avg Rate</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-300 uppercase">Rate Entries</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase">Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {topVendors.map((vendor, idx) => (
                  <tr key={idx} className="hover:bg-slate-700/30">
                    <td className="px-4 py-3 text-sm text-white">{vendor.name}</td>
                    <td className="px-4 py-3 text-sm text-blue-400 text-right font-mono">{formatRate(vendor.avgRate)}</td>
                    <td className="px-4 py-3 text-sm text-slate-400 text-right">{vendor.recordCount}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${vendor.businessSize === 'Small' ? 'bg-green-900/50 text-green-400' : 'bg-slate-600 text-slate-300'}`}>
                        {vendor.businessSize}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-xs text-slate-500 pb-4">
        <p>Data from GSA CALC+ (Contract-Awarded Labor Category) — ceiling rates from GSA MAS contracts</p>
        <p>Search terms: {data.searchTermsUsed.join(', ')} | Generated: {new Date(data.queryDate).toLocaleDateString()}</p>
      </div>
    </div>
  );
}
