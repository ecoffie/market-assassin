/**
 * Deterministic keywordCoverage stubs for Morehouse Ascend e2e (no USASpending).
 */
import type { KeywordCoverage } from '@/lib/market/keyword-coverage';

type NaicsStub = { code: string; name: string; amount: number; pct?: number };

function cov(
  anchor: string,
  partial: {
    totalMarket: number;
    allNaics: NaicsStub[];
    naicsCount?: number;
    topCodePct?: number;
    leadCodePct?: number;
    coverageCodes?: string[];
    coveragePct?: number;
    topPscList?: KeywordCoverage['topPscList'];
    pinnedPscCodes?: KeywordCoverage['pinnedPscCodes'];
  },
): KeywordCoverage {
  const allNaics = partial.allNaics.map((n) => ({
    code: n.code,
    name: n.name,
    amount: n.amount,
    pct: n.pct ?? Math.round((n.amount / partial.totalMarket) * 100),
  }));
  const top = allNaics[0]?.amount ?? partial.totalMarket;
  const topCodePct = partial.topCodePct ?? Math.round((top / partial.totalMarket) * 100);
  return {
    keyword: anchor,
    totalMarket: partial.totalMarket,
    naicsCount: partial.naicsCount ?? allNaics.length,
    allNaics,
    coverageCodes: partial.coverageCodes ?? allNaics.map((n) => n.code),
    coveragePct: partial.coveragePct ?? 0.9,
    topCodePct,
    leadCodePct: partial.leadCodePct ?? topCodePct,
    pscCount: partial.topPscList?.length ?? 0,
    topPsc: partial.topPscList?.[0] ?? null,
    topPscPct: partial.topPscList?.[0]?.pct ?? 0,
    topPscList: partial.topPscList ?? [],
    pinnedPscCodes: partial.pinnedPscCodes ?? null,
  };
}

/** Map anchor phrase → deterministic coverage for regression matrix. */
export function mockCoverageForAnchor(anchor: string): KeywordCoverage {
  const a = anchor.toLowerCase();

  if (a === 'and') {
    return cov(anchor, {
      totalMarket: 650_000_000_000,
      naicsCount: 120,
      topCodePct: 3,
      allNaics: [
        { code: '541512', name: 'Computer Systems Design', amount: 20_000_000_000 },
        { code: '541611', name: 'Admin Consulting', amount: 15_000_000_000 },
      ],
    });
  }

  if (/\bconcrete\b/.test(a)) {
    return cov(anchor, {
      totalMarket: 1_328,
      naicsCount: 2,
      topCodePct: 90,
      allNaics: [{ code: '238110', name: 'Poured Concrete', amount: 1_200 }],
    });
  }

  if (/\bcybersecurity\b/.test(a)) {
    return cov(anchor, {
      totalMarket: 4_200_000_000,
      naicsCount: 6,
      topCodePct: 42,
      allNaics: [
        { code: '541512', name: 'Computer Systems Design', amount: 1_800_000_000 },
        { code: '541519', name: 'Other Computer Related', amount: 900_000_000 },
      ],
    });
  }

  if (/\b(construction|civil)\b/.test(a)) {
    return cov(anchor, {
      totalMarket: 21_000_000,
      naicsCount: 4,
      topCodePct: 55,
      allNaics: [
        { code: '237110', name: 'Water/Sewer Line Construction', amount: 11_500_000 },
        { code: '236220', name: 'Commercial Building', amount: 4_000_000 },
      ],
    });
  }

  if (/\b(elevator|facilities)\b/.test(a)) {
    return cov(anchor, {
      totalMarket: 890_000_000,
      naicsCount: 5,
      topCodePct: 38,
      allNaics: [{ code: '811310', name: 'Commercial Machinery Repair', amount: 340_000_000 }],
    });
  }

  if (/\b(courier|delivery|logistics)\b/.test(a)) {
    return cov(anchor, {
      totalMarket: 1_100_000_000,
      naicsCount: 4,
      topCodePct: 35,
      allNaics: [{ code: '492110', name: 'Couriers', amount: 390_000_000 }],
    });
  }

  if (/\b(administrative|human resources|investigative)\b/.test(a)) {
    return cov(anchor, {
      totalMarket: 2_400_000_000,
      naicsCount: 5,
      topCodePct: 32,
      allNaics: [
        { code: '561110', name: 'Office Admin Services', amount: 780_000_000 },
        { code: '541611', name: 'Management Consulting', amount: 420_000_000 },
      ],
    });
  }

  if (/\bengineering\b/.test(a)) {
    return cov(anchor, {
      totalMarket: 3_100_000_000,
      naicsCount: 5,
      topCodePct: 34,
      allNaics: [{ code: '541330', name: 'Engineering Services', amount: 1_050_000_000 }],
    });
  }

  if (/\b(network|infrastructure|telecommunication)\b/.test(a)) {
    return cov(anchor, {
      totalMarket: 3_800_000_000,
      naicsCount: 7,
      topCodePct: 28,
      allNaics: [{ code: '517311', name: 'Wired Telecom', amount: 1_100_000_000 }],
    });
  }

  if (/\b(organizational|training|instructional)\b/.test(a)) {
    return cov(anchor, {
      totalMarket: 900_000_000,
      naicsCount: 6,
      topCodePct: 22,
      allNaics: [{ code: '611430', name: 'Professional Development', amount: 200_000_000 }],
    });
  }

  if (/\b(staffing|medical)\b/.test(a)) {
    return cov(anchor, {
      totalMarket: 6_500_000_000,
      naicsCount: 8,
      topCodePct: 30,
      allNaics: [{ code: '561320', name: 'Temporary Help', amount: 1_900_000_000 }],
    });
  }

  return cov(anchor, {
    totalMarket: 500_000_000,
    naicsCount: 4,
    topCodePct: 25,
    allNaics: [{ code: '541611', name: 'Management Consulting', amount: 125_000_000 }],
  });
}
