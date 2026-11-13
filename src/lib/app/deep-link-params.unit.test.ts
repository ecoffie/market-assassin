import { describe, expect, it } from 'vitest';
import {
  PROPOSAL_ACTION_TARGETS,
  PROPOSAL_ACTIONS,
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_ANCHORS,
  parseAgency,
  parseAppDeepLink,
  parseProposalAction,
  parsePursuitId,
  parseSettingsSection,
  parseVaultSection,
} from './deep-link-params';

const qs = (s: string) => new URLSearchParams(s);

describe('parseAppDeepLink — the links the Opportunity Map emits', () => {
  it('proposals: pursuit_id + each action', () => {
    for (const action of PROPOSAL_ACTIONS) {
      expect(parseAppDeepLink('proposals', qs(`panel=proposals&pursuit_id=abc-123&action=${action}`))).toEqual({
        pursuit_id: 'abc-123',
        proposal_action: action,
      });
    }
  });

  it('contacts: agency is trimmed + kept', () => {
    expect(parseAppDeepLink('contacts', qs('panel=contacts&agency=%20Department%20of%20the%20Navy%20'))).toEqual({
      agency: 'Department of the Navy',
    });
  });

  it('vault: documents section', () => {
    expect(parseAppDeepLink('vault', qs('panel=vault&section=documents'))).toEqual({ section: 'documents' });
  });

  it('settings: every section the settings drawer links to', () => {
    for (const section of ['billing', 'security', 'notifications', 'team']) {
      expect(parseAppDeepLink('settings', qs(`panel=settings&section=${section}`))).toEqual({ section });
    }
  });
});

describe('parseAppDeepLink — invalid values fall back to the panel default', () => {
  it('drops an unknown action but keeps a valid pursuit', () => {
    expect(parseAppDeepLink('proposals', qs('pursuit_id=p1&action=delete'))).toEqual({ pursuit_id: 'p1' });
  });
  it('drops a malformed pursuit id', () => {
    expect(parseAppDeepLink('proposals', qs('pursuit_id=<script>&action=review'))).toEqual({ proposal_action: 'review' });
    expect(parseAppDeepLink('proposals', qs(`pursuit_id=${'a'.repeat(65)}`))).toEqual({});
  });
  it('drops an unknown settings / vault section', () => {
    expect(parseAppDeepLink('settings', qs('section=danger'))).toEqual({});
    expect(parseAppDeepLink('vault', qs('section=billing'))).toEqual({});
    // A vault-only section is not a settings section.
    expect(parseAppDeepLink('settings', qs('section=documents'))).toEqual({});
  });
  it('drops an empty or oversized agency', () => {
    expect(parseAppDeepLink('contacts', qs('agency=%20%20'))).toEqual({});
    expect(parseAppDeepLink('contacts', qs(`agency=${'x'.repeat(201)}`))).toEqual({});
  });
  it('never applies params to the wrong panel', () => {
    expect(parseAppDeepLink('contacts', qs('pursuit_id=p1&action=review&section=billing'))).toEqual({});
    expect(parseAppDeepLink('proposals', qs('agency=Navy&section=billing'))).toEqual({});
    expect(parseAppDeepLink('dashboard', qs('agency=Navy&pursuit_id=p1'))).toEqual({});
    expect(parseAppDeepLink(null, qs('agency=Navy'))).toEqual({});
  });
});

describe('parseAppDeepLink — missing params', () => {
  it('returns an empty context', () => {
    for (const panel of ['proposals', 'contacts', 'vault', 'settings']) {
      expect(parseAppDeepLink(panel, qs(`panel=${panel}`))).toEqual({});
    }
  });
});

describe('single-value parsers', () => {
  it('normalise case/whitespace on closed sets', () => {
    expect(parseProposalAction(' Compliance ')).toBe('compliance');
    expect(parseSettingsSection('BILLING')).toBe('billing');
    expect(parseVaultSection('Documents')).toBe('documents');
    expect(parseProposalAction(null)).toBeUndefined();
  });
  it('agency strips control characters and collapses whitespace', () => {
    expect(parseAgency('Army\n\tCorps   of Engineers')).toBe('Army Corps of Engineers');
    expect(parseAgency(null)).toBeUndefined();
  });
  it('pursuit ids accept uuid-style values only', () => {
    expect(parsePursuitId('3f1c2b9e-0000-4000-8000-000000000000')).toBe('3f1c2b9e-0000-4000-8000-000000000000');
    expect(parsePursuitId('a b')).toBeUndefined();
  });
  it('every action + card-level settings section has a landing anchor (tab-level sections open the tab)', () => {
    for (const a of PROPOSAL_ACTIONS) expect(PROPOSAL_ACTION_TARGETS[a].anchorId).toMatch(/^proposal-/);
    const tabs = new Set(['matching', 'alerts', 'profile', 'account']);
    for (const s of SETTINGS_SECTIONS) {
      if (tabs.has(s)) expect(SETTINGS_SECTION_ANCHORS[s]).toBeNull();
      else expect(SETTINGS_SECTION_ANCHORS[s]).toMatch(/^settings-/);
    }
  });
});
