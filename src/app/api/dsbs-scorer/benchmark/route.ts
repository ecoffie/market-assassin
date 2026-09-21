/**
 * DSBS Scorer — NAICS Benchmark API
 *
 * GET /api/dsbs-scorer/benchmark?naics=541330&contracts=5&value=150000
 *
 * Returns competitor benchmarks for a given NAICS code using contractors.json.
 */

import { NextRequest, NextResponse } from 'next/server';
import contractorsData from '@/data/contractors.json';

interface Contractor {
  company: string;
  naics: string;
  contract_count: string;
  total_contract_value: string;
  contract_value_num: number;
  agencies: string;
  has_email: boolean;
  has_phone: boolean;
  has_contact: boolean;
  has_subcontract_plan: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const naics = searchParams.get('naics')?.trim();
  const userContracts = parseInt(searchParams.get('contracts') || '0');
  const userValue = parseFloat(searchParams.get('value') || '0');

  if (!naics) {
    return NextResponse.json({ error: 'NAICS code required' }, { status: 400 });
  }

  const contractors = contractorsData as Contractor[];

  // Match contractors by NAICS — split comma-separated NAICS field (bug prevention: don't exact-match joined string)
  const matched = contractors.filter(c => {
    if (!c.naics) return false;
    const codes = c.naics.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    // Match on full code or 4-digit prefix
    return codes.some(code => code === naics || code.startsWith(naics.slice(0, 4)));
  });

  // If too few matches, broaden to 3-digit prefix
  let results = matched;
  let broadened = false;
  if (matched.length < 5) {
    const prefix3 = naics.slice(0, 3);
    results = contractors.filter(c => {
      if (!c.naics) return false;
      const codes = c.naics.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
      return codes.some(code => code.startsWith(prefix3));
    });
    broadened = true;
  }

  if (results.length === 0) {
    return NextResponse.json({
      success: true,
      benchmark: null,
      message: 'No contractors found for this NAICS code',
    });
  }

  // Parse numeric values
  const parsed = results.map(c => ({
    company: c.company,
    contractCount: parseInt(c.contract_count) || 0,
    totalValue: c.contract_value_num || parseFloat(c.total_contract_value) || 0,
    agencies: c.agencies || '',
    hasEmail: c.has_email,
    hasContact: c.has_contact,
    hasSubPlan: c.has_subcontract_plan === 'True',
  }));

  // Aggregate stats
  const contractCounts = parsed.map(c => c.contractCount).sort((a, b) => a - b);
  const values = parsed.map(c => c.totalValue).filter(v => v > 0).sort((a, b) => a - b);

  const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
  const median = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  };
  const percentile = (arr: number[], value: number) => {
    if (arr.length === 0) return 50;
    const below = arr.filter(v => v < value).length;
    return Math.round((below / arr.length) * 100);
  };

  // Top contractors
  const topByValue = [...parsed].sort((a, b) => b.totalValue - a.totalValue).slice(0, 5);
  const topByCount = [...parsed].sort((a, b) => b.contractCount - a.contractCount).slice(0, 5);

  // Common agencies
  const agencyCount = new Map<string, number>();
  for (const c of parsed) {
    if (!c.agencies) continue;
    const agencies = c.agencies.split(/[,;]/).map(a => a.trim()).filter(Boolean);
    for (const agency of agencies) {
      agencyCount.set(agency, (agencyCount.get(agency) || 0) + 1);
    }
  }
  const commonAgencies = Array.from(agencyCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  return NextResponse.json({
    success: true,
    benchmark: {
      naicsCode: naics,
      broadened,
      totalContractors: results.length,
      avgContractCount: Math.round(avg(contractCounts)),
      medianContractValue: Math.round(median(values)),
      avgContractValue: Math.round(avg(values)),
      topByValue: topByValue.map(c => ({
        company: c.company,
        contractCount: c.contractCount,
        totalValue: c.totalValue,
      })),
      topByCount: topByCount.map(c => ({
        company: c.company,
        contractCount: c.contractCount,
        totalValue: c.totalValue,
      })),
      percentWithEmail: Math.round((parsed.filter(c => c.hasEmail).length / parsed.length) * 100),
      percentWithContact: Math.round((parsed.filter(c => c.hasContact).length / parsed.length) * 100),
      percentWithSubPlan: Math.round((parsed.filter(c => c.hasSubPlan).length / parsed.length) * 100),
      commonAgencies,
      userPercentileByContracts: percentile(contractCounts, userContracts),
      userPercentileByValue: percentile(values, userValue),
    },
  });
}
