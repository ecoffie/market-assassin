/**
 * Company research identity (ASK_MINDY_COMPANY_RESEARCH). Synthetic companies only (the repo is public).
 * Agent 4's required cases: a trading name resolves through a web candidate to the SAM legal name; two same-name
 * entities produce ONE question; no SAM match is a labelled web-only result; a UEI is never fabricated.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SAMEntity } from '@/lib/sam/entity-api';
import {
  companyResearchEnabledFor, extractCompanyClues, researchIdentityOnWeb, resolveCompanyIdentity, verifyCandidate, decideIdentity,
  identityPromptBlock, clarifyingQuestion, normalizeCompanyName, identifiersIn, type CompanyClues, type WebHit, type WebCandidate,
} from './company-research';

const clues = (over: Partial<CompanyClues> = {}): CompanyClues => ({ isCompanyRequest: true, companyNames: ['Ridgeline Digital'], personNames: [], website: null, city: null, state: null, uei: null, cage: null, ...over });
const ent = (uei: string, legal: string, over: Partial<SAMEntity> = {}): SAMEntity => ({
  ueiSAM: uei, cageCode: '1AB23', legalBusinessName: legal, registrationStatus: 'Active', isActive: true,
  physicalAddress: { city: 'Norfolk', stateOrProvince: 'VA' }, ...over,
}) as SAMEntity;
const HIT: WebHit = { title: 'Ridgeline Digital | About', url: 'https://ridgelinedigital.example/about', snippet: 'Ridgeline Digital is the trade name of Ridgeline Federal Services LLC, a veteran-owned firm based in Norfolk, VA.' };
const searchOk = (hits: WebHit[]) => vi.fn(async () => ({ ok: true, grounded: hits.length > 0, available: true, results: hits }));

describe('flag', () => {
  it('is off by default and on only for the allowlist', () => {
    expect(companyResearchEnabledFor('a@b.com', {})).toBe(false);
    expect(companyResearchEnabledFor('a@b.com', { ASK_MINDY_COMPANY_RESEARCH: 'true', ASK_MINDY_COMPANY_RESEARCH_ALLOWLIST: 'x@y.com' })).toBe(false);
    expect(companyResearchEnabledFor('a@b.com', { ASK_MINDY_COMPANY_RESEARCH: 'true', ASK_MINDY_COMPANY_RESEARCH_ALLOWLIST: 'a@b.com' })).toBe(true);
  });
});

describe('a trading name resolves through a web candidate to the SAM legal name', () => {
  it('web says the trade name belongs to an LLC; SAM has the LLC; the match states its evidence and URL', async () => {
    const propose = vi.fn(async () => [{ legalName: 'Ridgeline Federal Services LLC', dbaName: 'Ridgeline Digital', website: 'ridgelinedigital.example', city: 'Norfolk', state: 'VA', uei: null, cage: null, sourceUrls: [HIT.url] }]);
    const web = await researchIdentityOnWeb(clues(), { search: searchOk([HIT]), propose });
    expect(web.status).toBe('searched');
    const samLookup = vi.fn(async (i: { name?: string }) => ({ entity: null, matches: i.name === 'Ridgeline Federal Services LLC' ? [ent('RFS000000001', 'RIDGELINE FEDERAL SERVICES LLC')] : [] }));
    const id = await resolveCompanyIdentity(clues(), web, { samLookup });
    expect(samLookup).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ridgeline Digital' }));
    expect(samLookup).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ridgeline Federal Services LLC', state: 'VA' }));
    expect(id.decision.status).toBe('confirmed');
    if (id.decision.status !== 'confirmed') return;
    expect(id.decision.entity.uei).toBe('RFS000000001');
    expect(id.decision.entity.matched).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'legal_name', from: 'web', url: HIT.url }),
      expect.objectContaining({ field: 'state', value: 'VA' }),
      expect.objectContaining({ field: 'city' }),
    ]));
    const block = identityPromptBlock(id);
    expect(block).toContain('IDENTITY (CONFIRMED): RIDGELINE FEDERAL SERVICES LLC');
    expect(block).toContain('SAM UEI RFS000000001');
    expect(block).toContain(`open web: ${HIT.url}`);
  });

  it('name plus only one corroborating fact is LIKELY, and the answer must say so and ask to confirm', () => {
    const d = decideIdentity([ent('RFS000000001', 'Ridgeline Digital LLC')], clues({ state: 'VA' }), []);
    expect(d.status).toBe('likely');
    const block = identityPromptBlock({ clues: clues(), web: { status: 'searched', hits: [], candidates: [] }, decision: d, samUnavailable: false });
    expect(block).toMatch(/LIKELY match, not confirmed/);
  });
});

describe('two same-name entities produce one clarifying question', () => {
  it('two registrations with the same name and nothing to separate them: ambiguous, one question listing both', async () => {
    const samLookup = vi.fn(async () => ({ entity: null, matches: [ent('AAA000000001', 'Ridgeline Digital LLC', { physicalAddress: { city: 'Norfolk', stateOrProvince: 'VA' } }), ent('BBB000000002', 'Ridgeline Digital Inc', { physicalAddress: { city: 'Austin', stateOrProvince: 'TX' } })] }));
    const id = await resolveCompanyIdentity(clues(), { status: 'searched', hits: [], candidates: [] }, { samLookup });
    expect(id.decision.status).toBe('ambiguous');
    if (id.decision.status !== 'ambiguous') return;
    const q = clarifyingQuestion(id.decision);
    expect(q).toContain('Ridgeline Digital LLC, Norfolk, VA');
    expect(q).toContain('Ridgeline Digital Inc, Austin, TX');
    expect((q.match(/\?/g) || []).length).toBe(1);
  });
  it('a customer-given state separates them: no question, the matching one is chosen', () => {
    const d = decideIdentity([ent('AAA000000001', 'Ridgeline Digital LLC'), ent('BBB000000002', 'Ridgeline Digital Inc', { physicalAddress: { city: 'Austin', stateOrProvince: 'TX' } })], clues({ state: 'TX' }), []);
    expect(d.status).toBe('likely');
    if (d.status === 'likely') expect(d.entity.uei).toBe('BBB000000002');
  });
  it('the same UEI returned twice is one entity, never a false ambiguity', () => {
    const d = decideIdentity([ent('AAA000000001', 'Ridgeline Digital LLC'), ent('AAA000000001', 'Ridgeline Digital LLC')], clues(), []);
    expect(d.status).toBe('likely');
  });
});

describe('no SAM match is a labelled web-only result', () => {
  it('a similar but different registered name is not evidence: not found', () => {
    expect(decideIdentity([ent('CCC000000003', 'Ridgeline Digital Systems Inc')], clues(), []).status).toBe('not_found');
  });
  it('not found: the answer is told "no federal registration found", never to invent a UEI, and keeps web URLs', async () => {
    const propose = vi.fn(async () => [{ legalName: 'Ridgeline Federal Services LLC', dbaName: null, website: null, city: 'Norfolk', state: 'VA', uei: null, cage: null, sourceUrls: [HIT.url] }]);
    const web = await researchIdentityOnWeb(clues(), { search: searchOk([HIT]), propose });
    const id = await resolveCompanyIdentity(clues(), web, { samLookup: async () => ({ entity: null, matches: [] }) });
    expect(id.decision.status).toBe('not_found');
    const block = identityPromptBlock(id);
    expect(block).toContain('NO FEDERAL REGISTRATION FOUND');
    expect(block).toContain('Do NOT invent a UEI');
    expect(block).toContain(HIT.url);
    expect(block).not.toMatch(/SAM UEI [A-Z0-9]{12}/);
  });
  it('SAM unreachable is "not checked", never "not registered"', async () => {
    const id = await resolveCompanyIdentity(clues(), { status: 'searched', hits: [], candidates: [] }, { samLookup: async () => { throw new Error('down'); } });
    expect(id.decision.status).toBe('not_checked');
    expect(identityPromptBlock(id)).toMatch(/could not be checked this turn; never imply it does not exist/);
  });
});

describe('no fabricated UEI (or name) from the web step', () => {
  it('a UEI or name the cited results do not show is dropped', () => {
    const c: WebCandidate = { legalName: 'Invented Holdings LLC', dbaName: 'Ridgeline Digital', website: null, city: null, state: null, uei: 'ZZZ999999999', cage: null, sourceUrls: [HIT.url] };
    const v = verifyCandidate(c, [HIT]);
    expect(v?.legalName).toBeNull();
    expect(v?.uei).toBeNull();
    expect(v?.dbaName).toBe('Ridgeline Digital');
  });
  it('a candidate citing no returned result is dropped entirely', () => {
    expect(verifyCandidate({ legalName: 'Ridgeline Federal Services LLC', dbaName: null, website: null, city: null, state: null, uei: null, cage: null, sourceUrls: ['https://elsewhere.example'] }, [HIT])).toBeNull();
  });
  it('a web UEI that SAM does not confirm never reaches the answer as an identity', async () => {
    const hit: WebHit = { ...HIT, snippet: `${HIT.snippet} UEI ABC123DEF456.` };
    const web = await researchIdentityOnWeb(clues(), { search: searchOk([hit]), propose: async () => [{ legalName: null, dbaName: 'Ridgeline Digital', website: null, city: null, state: null, uei: 'ABC123DEF456', cage: null, sourceUrls: [hit.url] }] });
    const id = await resolveCompanyIdentity(clues(), web, { samLookup: async () => ({ entity: null, matches: [] }) });
    expect(id.decision.status).toBe('not_found');
    expect(identityPromptBlock(id)).not.toContain('SAM UEI ABC123DEF456');
  });
});

describe('web search gaps are disclosed, never shown as "nothing found"', () => {
  it('not configured', async () => {
    const web = await researchIdentityOnWeb(clues(), { search: vi.fn(async () => ({ ok: true, grounded: false, available: false, results: [] })), propose: vi.fn() });
    expect(web.status).toBe('not_configured');
    const id = await resolveCompanyIdentity(clues(), web, { samLookup: async () => ({ entity: null, matches: [] }) });
    expect(identityPromptBlock(id)).toMatch(/Web search is NOT configured/);
  });
});

describe('clues come only from the customer\'s words', () => {
  const client = (out: Record<string, unknown>) => ({ messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify(out) }] }) } }) as never;
  it('a name the model adds that the customer never wrote is dropped', async () => {
    const c = await extractCompanyClues('What should Ridgeline Digital go after?', { client: client({ is_company_request: true, company_names: ['Ridgeline Digital', 'Ridgeline Federal Services LLC'], person_names: [], city: null, state: null }) });
    expect(c.companyNames).toEqual(['Ridgeline Digital']);
    expect(c.isCompanyRequest).toBe(true);
  });
  it('no verified name means not a company turn, whatever the model says', async () => {
    const c = await extractCompanyClues('What janitorial work is open in Florida?', { client: client({ is_company_request: true, company_names: ['Acme'], person_names: [], city: null, state: 'FL' }) });
    expect(c.isCompanyRequest).toBe(false);
  });
  it('UEI, CAGE and website are read deterministically', () => {
    expect(identifiersIn('Look at UEI ABC123DEF456, CAGE 1AB23, site www.ridgelinedigital.com')).toEqual({ uei: 'ABC123DEF456', cage: '1AB23', website: 'ridgelinedigital.com' });
  });
  it('names compare without case, punctuation or legal-form suffix', () => {
    expect(normalizeCompanyName('Ridgeline Digital, L.L.C.')).toBe(normalizeCompanyName('RIDGELINE DIGITAL LLC'));
    expect(normalizeCompanyName('Ridgeline Digital Systems Inc')).not.toBe(normalizeCompanyName('Ridgeline Digital'));
  });
});
