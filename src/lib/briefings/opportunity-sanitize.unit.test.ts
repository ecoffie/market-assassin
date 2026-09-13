import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  actualSourceTitle,
  currentContractStatus,
  marketMatchReason,
  opportunitiesFromSources,
  opportunitySourceFromContract,
  overlayOpportunityAnalysis,
  sanitizeWeeklyOpportunities,
  weeklyOpportunityGrounding,
} from './opportunity-sanitize';

const SAVED = ['541511', '541512', '541513', '541519'];
const FUTURE = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);

const IN_MARKET = opportunitySourceFromContract(
  {
    contractNumber: 'HHSN261201800001C',
    contractName: 'NCI Oncology Clinical Trial System, Management and Support',
    agency: 'Department of Health and Human Services',
    incumbent: 'Acme IT',
    value: 12_000_000,
    naicsCode: '541512',
    expirationDate: FUTURE,
    matchFactors: ['NAICS', 'Keyword:Identity'],
  },
  SAVED,
)!;

describe('weekly opportunity grounding — source ID, title, status, market-match', () => {
  it('builds a source from the award record and refuses placeholders / off-market / undated rows', () => {
    expect(IN_MARKET.sourceId).toBe('HHSN261201800001C');
    expect(IN_MARKET.title).toBe('NCI Oncology Clinical Trial System, Management and Support');
    expect(IN_MARKET.status).toMatch(new RegExp(`^Expiring ${FUTURE}`));
    expect(IN_MARKET.marketMatchReason).toContain('NAICS 541512 is in this saved market');
    expect(IN_MARKET.marketMatchReason).toContain('keyword "Identity" in title');

    expect(actualSourceTitle('Contract')).toBeNull();
    expect(actualSourceTitle('541512 Contract')).toBeNull();
    expect(currentContractStatus('October 1, 2026')).toBeNull();
    expect(
      opportunitySourceFromContract(
        { ...IN_MARKET, contractNumber: IN_MARKET.sourceId, contractName: IN_MARKET.title, naicsCode: '236220' },
        SAVED,
      ),
    ).toBeNull();
    expect(
      opportunitySourceFromContract(
        {
          contractNumber: 'X',
          contractName: 'Real title',
          naicsCode: '541512',
          expirationDate: '',
        },
        SAVED,
      ),
    ).toBeNull();
  });

  it('keyword match is not a market-match reason without saved-industry NAICS', () => {
    expect(
      marketMatchReason({
        naicsCode: '236220',
        savedNaics: SAVED,
        matchFactors: ['Keyword:Identity', 'KeywordDesc:PAM'],
      }),
    ).toBeNull();
  });

  it('generate-time: overlay analysis only onto the matching sourceId; ignore invented names', () => {
    const grounded = opportunitiesFromSources([IN_MARKET], 10);
    const merged = overlayOpportunityAnalysis(grounded, [
      {
        sourceId: 'HHSN261201800001C',
        displacementAngle: 'Incumbent stretch across clinical-trial IT',
        competitiveLandscape: ['Low bid count'],
        recommendedApproach: 'Request a capability briefing',
      },
      {
        sourceId: 'FAKE-PIID',
        displacementAngle: 'Invented contract',
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].contractName).toBe(IN_MARKET.title);
    expect(merged[0].displacementAngle).toContain('clinical-trial');
    const { kept, dropped } = sanitizeWeeklyOpportunities(
      [
        ...merged,
        {
          rank: 2,
          contractName: 'OPERATION AND SUSTAINMENT OF THE DODIN/DISN INFRASTRUCTURE',
          agency: 'DISA',
          incumbent: 'Someone',
          value: 1,
          window: 'soon',
          displacementAngle: 'invented',
        },
      ],
      [IN_MARKET],
    );
    expect(kept.map((row) => row.sourceId)).toEqual(['HHSN261201800001C']);
    expect(dropped).toHaveLength(1);
  });

  it('send-time cached templates: omit rows missing any required field', () => {
    const { kept, dropped } = sanitizeWeeklyOpportunities([
      { contractName: 'GOES-R GROUND SYSTEM DEVELOPMENT', agency: 'NOAA' },
      {
        sourceId: 'HHSN261201800001C',
        title: IN_MARKET.title,
        status: IN_MARKET.status,
        marketMatchReason: IN_MARKET.marketMatchReason,
      },
      {
        sourceId: 'HHSN261201800001C',
        title: IN_MARKET.title,
        status: IN_MARKET.status,
        // missing market-match reason
      },
    ]);
    expect(dropped).toHaveLength(2);
    expect(kept).toHaveLength(1);
    expect(kept[0].contractName).toBe(IN_MARKET.title);
  });

  it('does not keep an LLM rename even when the sourceId is attached', () => {
    const { kept } = sanitizeWeeklyOpportunities(
      [
        {
          sourceId: IN_MARKET.sourceId,
          title: 'OPERATION AND SUSTAINMENT OF THE DODIN/DISN INFRASTRUCTURE',
          status: IN_MARKET.status,
          marketMatchReason: IN_MARKET.marketMatchReason,
        },
      ],
      [IN_MARKET],
    );
    expect(kept).toHaveLength(0);
  });

  it('empty list is valid — do not invent filler opportunities', () => {
    expect(opportunitiesFromSources([], 10)).toEqual([]);
    expect(weeklyOpportunityGrounding([])).toEqual({ grounded: 0, ungrounded: 0 });
    expect(overlayOpportunityAnalysis(opportunitiesFromSources([IN_MARKET]), { not: 'an array' } as never)).toHaveLength(1);
  });

  it('never fabricates a status when the award has no verified date', () => {
    expect(currentContractStatus('')).toBeNull();
    expect(currentContractStatus('2026-02-30')).toBeNull();
  });
});

describe('send-weekly-fast call site', () => {
  it('sanitizes cached opportunities and calendar before send', () => {
    const src = readFileSync(join(__dirname, '../../app/api/cron/send-weekly-fast/route.ts'), 'utf8');
    expect(src).toMatch(/sanitizeWeeklyOpportunities/);
    expect(src).toMatch(/sanitizeBriefingCalendar/);
    expect(src).toMatch(/if \(briefing\.opportunities\.length === 0\)/);
  });
});
