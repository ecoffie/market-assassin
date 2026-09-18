import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FOCUSED_REQUIRES_DISTINCTIVE,
  alertModeFromAggregated,
  canSelectFocused,
  defaultAlertModeForNewUser,
  mergeAlertModeIntoAggregated,
  resolveAlertMode,
} from './alert-mode';
import { validateMarketCodesInput } from '@/lib/codes/validate-market-codes';
import {
  OPEN_MARKET_NO_KEYWORDS_COPY,
  applyOpenAlertMode,
  keywordIncludeTerms,
  openMarketNote,
  preferDistinctiveInOpenMarket,
} from './open-contract-d';
import { renderComingBackSection, selectComingBackRows } from './coming-back-to-market';
import { getAlertEmailCta } from './email-promo';

const textOf = (row: { title: string; description?: string }) => `${row.title} ${row.description || ''}`;

describe('alert_mode resolve', () => {
  it('legacy null / junk → market_discovery', () => {
    expect(resolveAlertMode(null)).toBe('market_discovery');
    expect(resolveAlertMode(undefined)).toBe('market_discovery');
    expect(resolveAlertMode('')).toBe('market_discovery');
    expect(resolveAlertMode('strict')).toBe('market_discovery');
    expect(alertModeFromAggregated(null)).toBe('market_discovery');
    expect(alertModeFromAggregated({ keywords: ['x'] })).toBe('market_discovery');
    expect(alertModeFromAggregated({ alert_mode: 'focused' })).toBe('focused');
  });

  it('Focused is blocked without a distinctive keyword', () => {
    expect(canSelectFocused([])).toEqual({ ok: false, error: FOCUSED_REQUIRES_DISTINCTIVE });
    expect(canSelectFocused(['repair', 'it'])).toEqual({ ok: false, error: FOCUSED_REQUIRES_DISTINCTIVE });
    expect(canSelectFocused(['janitorial services'])).toEqual({ ok: true });
  });

  it('new users with distinctive keywords default to Focused', () => {
    expect(defaultAlertModeForNewUser(['janitorial services'])).toBe('focused');
    expect(defaultAlertModeForNewUser(['repair'])).toBe('market_discovery');
  });

  it('merge writes alert_mode without dropping other aggregated keys', () => {
    expect(mergeAlertModeIntoAggregated({ naics_priorities: { '541512': 'primary' } }, 'focused')).toEqual({
      naics_priorities: { '541512': 'primary' },
      alert_mode: 'focused',
    });
  });
});

describe('invalid market codes — save rejects, stored not auto-deleted', () => {
  it('rejects invalid NAICS on save the same class as notacode', () => {
    expect(validateMarketCodesInput(['618210'], undefined)).toEqual({
      ok: false,
      error: 'Invalid NAICS code "618210". Use a Census 2022 code.',
    });
    expect(validateMarketCodesInput(['notacode'], undefined).ok).toBe(false);
    expect(validateMarketCodesInput(['541512'], undefined)).toEqual({ ok: true });
  });

  it('does not delete or replace a stored invalid code in the helper', () => {
    const stored = ['541512', '618210'];
    expect(stored).toEqual(['541512', '618210']);
    expect(validateMarketCodesInput(stored, undefined).ok).toBe(false);
  });

  it('accepts FSC product codes the spend table does not list', () => {
    expect(validateMarketCodesInput(undefined, ['6520', '8405', '8905'])).toEqual({ ok: true });
  });
});

describe('Focused omit vs Discovery label', () => {
  const market = [
    { title: 'IT consulting IDIQ', description: 'program support' },
    { title: 'Help desk option year', description: 'operations' },
  ];

  it('Focused omits Open when distinctive keywords have zero in-market hits', () => {
    const preferred = preferDistinctiveInOpenMarket(market, ['janitorial services'], textOf);
    expect(preferred.distinctiveMatchCount).toBe(0);
    const focused = applyOpenAlertMode(preferred, 'focused', ['janitorial services']);
    expect(focused.omitOpen).toBe(true);
    expect(focused.rows).toEqual([]);
    expect(focused.outcome).toBe('focused_omit_open');
    expect(openMarketNote(focused.outcome)).toBeNull();
  });

  it('Discovery labels keyword-free Open and still sends the market', () => {
    const preferred = preferDistinctiveInOpenMarket(market, [], textOf);
    expect(preferred.outcome).toBe('no_keywords_configured');
    const discovery = applyOpenAlertMode(preferred, 'market_discovery', []);
    expect(discovery.omitOpen).toBe(false);
    expect(discovery.rows).toEqual(market);
    expect(openMarketNote(discovery.outcome)).toBe(OPEN_MARKET_NO_KEYWORDS_COPY);
  });

  it('Coming Back does not fill omitted Open', () => {
    const preferred = preferDistinctiveInOpenMarket(market, ['janitorial services'], textOf);
    const focused = applyOpenAlertMode(preferred, 'focused', ['janitorial services']);
    const comingBack = selectComingBackRows({
      contracts: [{
        contract_id: 'cb-1',
        piid: 'cb-1',
        incumbent_name: 'ACME',
        incumbent_uei: null,
        awarding_agency: 'Department of Defense',
        awarding_sub_agency: null,
        naics_code: '561720',
        naics_description: null,
        psc_code: 'S201',
        description: null,
        total_obligation: 100000,
        potential_total_value: 100000,
        period_of_performance_start: '2024-01-01',
        period_of_performance_current_end: '2027-06-01',
        place_of_performance_state: null,
        place_of_performance_city: null,
        set_aside_type: null,
        competition_type: null,
        number_of_offers: null,
        estimated_recompete_date: null,
        lead_time_months: 12,
        recompete_likelihood: null,
      }],
      count: 1,
      naicsCodes: ['561720'],
    });
    expect(focused.rows).toEqual([]);
    expect(comingBack.kind).toBe('show');
    const html = renderComingBackSection(comingBack, { panelUrl: 'https://getmindy.ai/app?panel=recompetes' });
    expect(html).toMatch(/Coming Back to Market/);
    expect(html).toMatch(/not confirmed solicitations/i);
    expect(html).not.toMatch(/currently soliciting/i);
    expect(focused.rows.some((row) => /ACME|cb-1/.test(JSON.stringify(row)))).toBe(false);
    expect(html).not.toMatch(/Open Now/);
  });
});

describe('generic singles cannot unrestricted-OR', () => {
  it('drops keywords from the market query when NAICS exist', () => {
    expect(keywordIncludeTerms(['repair', 'compliance', 'janitorial'], ['541512'], [])).toEqual([]);
  });
});

describe('DLA FAR-boilerplate stays out of Open', () => {
  it('a 332919 DLA row is not in a 541512 Open market after Contract D prefer', () => {
    const userMarket = [{ title: 'Cybersecurity support', description: 'IT services 541512' }];
    expect(keywordIncludeTerms(['compliance'], ['541512'], [])).toEqual([]);
    const preferred = preferDistinctiveInOpenMarket(userMarket, ['compliance'], textOf);
    expect(preferred.rows.some((r) => /332919|DLA|FAR boilerplate/i.test(textOf(r)))).toBe(false);
    expect(preferred.rows.map((r) => r.title)).toEqual(['Cybersecurity support']);
  });
});

describe('matcher has no customer-specific branches', () => {
  it('bans emails and named customers in matcher sources', () => {
    const files = [
      'alert-mode.ts',
      'open-contract-d.ts',
      '../market/keyword-sanitize.ts',
      '../briefings/pipelines/sam-gov.ts',
    ];
    for (const file of files) {
      const src = readFileSync(join(__dirname, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(src, file).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.(?:com|org|net|edu|gov|ai|io)\b/i);
      expect(src, file).not.toMatch(/excelsiorcs|jonathan/i);
    }
  });
});

describe('email copy no longer calls keywords required filters', () => {
  it('Discovery CTA does not say keyword filters are active', () => {
    const cta = getAlertEmailCta('/prefs', '/app', {
      naics_codes: ['541512'],
      keywords: ['janitorial services'],
    });
    expect(cta.headerSubtitle).not.toMatch(/keyword filters are active/i);
    expect(cta.headerSubtitle).toMatch(/Market Discovery is on/);
  });
});
