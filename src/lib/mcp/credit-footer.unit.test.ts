import { describe, it, expect } from 'vitest';
import { creditFooter } from './credit-footer';

const PURCHASE = /getmindy\.ai\/mcp|top up/i;
const member = { orgName: 'Acme', isOwner: false };
const owner = { orgName: 'Acme', isOwner: true };

describe('creditFooter — pooled calls never sell personal credits', () => {
  for (const [label, ctx] of [['member', member], ['owner', owner], ['unknown role', { orgName: null, isOwner: null }]] as const) {
    for (const bal of [0, 5, 20, 500]) {
      it(`${label} at ${bal}: no purchase link`, () => {
        expect(creditFooter(5, bal, ctx)).not.toMatch(PURCHASE);
      });
    }
  }

  it('a low pool tells a member to ask their team owner', () => {
    expect(creditFooter(5, 5, member)).toBe('⚠️ Team pool is low (Acme): 5 left · this call used 5 credits. Ask your team owner about adding credits. The pool refills at the start of next month.');
  });

  it('a low pool tells the owner the real remedy (monthly refill, support for a bigger allowance)', () => {
    expect(creditFooter(5, 0, owner)).toMatch(/refills at the start of next month.*support@getmindy\.ai/);
  });

  it('a healthy pool just reports the team balance', () => {
    expect(creditFooter(5, 500, member)).toBe('Team credits (Acme): 500 remaining · this call used 5 credits.');
  });
});

describe('creditFooter — personal calls unchanged', () => {
  it('low personal balance still routes to top-up', () => {
    expect(creditFooter(5, 15)).toBe('⚠️ Mindy credits: 15 left · this call used 5 credits — running low. Top up → getmindy.ai/mcp');
  });
  it('free tool has no footer', () => {
    expect(creditFooter(0, null)).toBeNull();
  });
});
