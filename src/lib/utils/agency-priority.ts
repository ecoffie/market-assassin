import type { AgencyBudgetData } from '@/types/federal-market-assassin';
import { getBudgetForAgency } from '@/lib/utils/budget-authority';

export const SIMPLIFIED_ACQUISITION_THRESHOLD = 350000;
export const MICRO_PURCHASE_THRESHOLD = 15000;

interface AgencyPriorityInput {
  name?: string | null;
  contractingOffice?: string | null;
  subAgency?: string | null;
  parentAgency?: string | null;
  setAsideSpending?: number | null;
  contractCount?: number | null;
  satContractCount?: number | null;
  microContractCount?: number | null;
}

export interface AgencyPriorityBreakdown {
  score: number;
  satScore: number;
  microScore: number;
  volumeScore: number;
  spendScore: number;
  budgetScore: number;
  budgetTrend?: AgencyBudgetData['change']['trend'];
  budgetChangePercent?: number;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

export function getAgencyBudgetSignal(agency: AgencyPriorityInput): AgencyBudgetData | null {
  return getBudgetForAgency(agency.parentAgency || '')
    || getBudgetForAgency(agency.subAgency || '')
    || getBudgetForAgency(agency.name || '')
    || getBudgetForAgency(agency.contractingOffice || '');
}

export function scoreAgencyPriority(agency: AgencyPriorityInput): AgencyPriorityBreakdown {
  const contractCount = safeNumber(agency.contractCount);
  const satContractCount = safeNumber(agency.satContractCount);
  const microContractCount = safeNumber(agency.microContractCount);
  const spending = safeNumber(agency.setAsideSpending);

  const satPercent = contractCount > 0 ? satContractCount / contractCount : 0;
  const microPercent = contractCount > 0 ? microContractCount / contractCount : 0;
  const satScore = clamp(satPercent * 100);
  const microScore = clamp(microPercent * 100);
  const volumeScore = clamp((Math.log10(Math.max(1, satContractCount)) / Math.log10(500)) * 100);
  const spendScore = clamp((Math.log10(Math.max(1, spending)) / Math.log10(1_000_000_000)) * 100);

  const budget = getAgencyBudgetSignal(agency);
  const budgetChangePercent = budget ? (budget.change.percent - 1) * 100 : undefined;
  const budgetScore = budget
    ? budget.change.trend === 'surging'
      ? 100
      : budget.change.trend === 'growing'
        ? 80
        : budget.change.trend === 'stable'
          ? 55
          : budget.change.trend === 'declining'
            ? 30
            : 10
    : 45;

  // Small-business-first weighting: easy-entry activity is more important than raw dollars.
  const score = Math.round(
    satScore * 0.35
    + microScore * 0.15
    + volumeScore * 0.20
    + budgetScore * 0.20
    + spendScore * 0.10
  );

  return {
    score,
    satScore: Math.round(satScore),
    microScore: Math.round(microScore),
    volumeScore: Math.round(volumeScore),
    spendScore: Math.round(spendScore),
    budgetScore,
    budgetTrend: budget?.change.trend,
    budgetChangePercent,
  };
}

export function sortAgenciesForSmallBusiness<T extends AgencyPriorityInput>(agencies: T[]): T[] {
  return [...agencies].sort((a, b) => {
    const aScore = scoreAgencyPriority(a).score;
    const bScore = scoreAgencyPriority(b).score;
    if (bScore !== aScore) return bScore - aScore;
    return safeNumber(b.setAsideSpending) - safeNumber(a.setAsideSpending);
  });
}
