import { describe, expect, it } from 'vitest';
import type { AppPanel } from './UnifiedSidebar';
import {
  NAV_GROUPS,
  NAV_PANELS,
  canAccessPanel,
  clickActionFor,
  groupForPanel,
  groupSummary,
  isGroupLocked,
  isGroupVisible,
  primaryMember,
  visibleMembers,
} from './nav-groups';

// Every panel the pre-grouping sidebar (NAV_SECTIONS) exposed as a row. The Opportunity Map
// entry is an external route link, kept as its own row, and is not a panel group member.
const PREVIOUSLY_EXPOSED: AppPanel[] = [
  'chat', 'dashboard', 'alerts', 'market-intel',
  'pipeline', 'target-list',
  'pricing', 'proposals',
  'research', 'forecasts', 'recompetes', 'disa-watch', 'osbp-smb', 'micc-mrr', 'grants',
  'contractors', 'decision-makers',
  'vault', 'team', 'coach', 'settings',
];

// Panels that exist (PanelContainer renders them, deep links reach them) but were NOT sidebar rows.
const HIDDEN_PANELS: AppPanel[] = ['my-market', 'contacts', 'library', 'knowledge-base', 'partner-finder', 'dibbs'];

const free = { userTier: 'free' as const };
const pro = { userTier: 'pro' as const };
const team = { userTier: 'team' as const };

describe('nav groups', () => {
  it('puts every previously exposed panel in exactly one group as a tab', () => {
    for (const panel of PREVIOUSLY_EXPOSED) {
      const owners = NAV_GROUPS.filter((g) => g.members.some((m) => m.panel === panel));
      expect(owners.map((g) => g.id), panel).toHaveLength(1);
    }
  });

  it('has no member that is not a known sidebar panel, and no duplicate members', () => {
    const all = NAV_GROUPS.flatMap((g) => g.members.map((m) => m.panel));
    expect(new Set(all).size).toBe(all.length);
    for (const panel of all) {
      expect(NAV_PANELS[panel], panel).toBeDefined();
      expect(PREVIOUSLY_EXPOSED).toContain(panel);
    }
    expect(all).toHaveLength(PREVIOUSLY_EXPOSED.length);
  });

  it('keeps hidden panels out of the tabs but maps them to one group for highlighting', () => {
    const members = new Set(NAV_GROUPS.flatMap((g) => g.members.map((m) => m.panel)));
    for (const panel of HIDDEN_PANELS) {
      expect(members.has(panel), panel).toBe(false);
      const owners = NAV_GROUPS.filter((g) => g.aliases?.includes(panel));
      expect(owners, panel).toHaveLength(1);
      expect(groupForPanel(panel)?.id).toBe(owners[0].id);
    }
  });

  it('uses the approved labels and order', () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual([
      'Ask Mindy', 'Opportunities', 'Coming up', 'My Pursuits', 'Win the bid',
      'Market Research', 'Players', 'Account', 'For government',
    ]);
    const tabs = Object.fromEntries(NAV_GROUPS.map((g) => [g.id, g.members.map((m) => `${m.panel}:${m.tab}`)]));
    expect(tabs.opportunities).toEqual(['dashboard:For you', 'alerts:All matches', 'market-intel:Charts & export', 'grants:Grants']);
    expect(tabs['coming-up']).toEqual(['forecasts:Upcoming buys', 'recompetes:Expiring contracts', 'disa-watch:Vehicle watch']);
    expect(tabs.pursuits).toEqual(['pipeline:Opportunities', 'target-list:Offices']);
    expect(tabs.win).toEqual(['pricing:Pricing', 'proposals:Proposals']);
    expect(tabs.players).toEqual(['contractors:Companies', 'decision-makers:Government contacts']);
    expect(tabs.account).toEqual(['settings:Settings', 'vault:My Vault', 'team:Team', 'coach:Clients']);
    expect(tabs.government).toEqual(['osbp-smb:SMB market research', 'micc-mrr:KO research workspace']);
  });

  it('deep links resolve to the group containing the panel', () => {
    expect(groupForPanel('alerts')?.label).toBe('Opportunities');
    expect(groupForPanel('target-list')?.label).toBe('My Pursuits');
    expect(groupForPanel('coach')?.label).toBe('Account');
  });

  it('shows "For government" only to prototype-allowlisted accounts (and hides Vehicle watch otherwise)', () => {
    const gov = NAV_GROUPS.find((g) => g.id === 'government')!;
    const coming = NAV_GROUPS.find((g) => g.id === 'coming-up')!;
    expect(isGroupVisible(gov, pro)).toBe(false);
    expect(isGroupVisible(gov, { ...pro, canSeePrototypes: true })).toBe(true);
    expect(visibleMembers(coming, pro).map((m) => m.panel)).toEqual(['forecasts', 'recompetes']);
    expect(visibleMembers(coming, { ...pro, canSeePrototypes: true }).map((m) => m.panel)).toContain('disa-watch');
  });

  it('a group click opens its first ACCESSIBLE member', () => {
    const opps = NAV_GROUPS.find((g) => g.id === 'opportunities')!;
    expect(primaryMember(opps, pro)?.panel).toBe('dashboard');
    // Free: For you (Pro) is locked → All matches.
    expect(primaryMember(opps, free)?.panel).toBe('alerts');
    expect(isGroupLocked(opps, free)).toBe(false);
  });

  it('a fully locked group keeps the old locked behaviour on its first member', () => {
    const pursuits = NAV_GROUPS.find((g) => g.id === 'pursuits')!;
    const win = NAV_GROUPS.find((g) => g.id === 'win')!;
    expect(isGroupLocked(pursuits, free)).toBe(true);
    expect(clickActionFor(primaryMember(pursuits, free)!.panel, free)).toBe('free_preview');
    expect(clickActionFor(primaryMember(win, free)!.panel, free)).toBe('upgrade');
  });

  it('keeps per-panel tier locks (Team / Clients, coach mode)', () => {
    expect(canAccessPanel('team', pro)).toBe(false);
    expect(canAccessPanel('team', team)).toBe(true);
    expect(canAccessPanel('coach', pro)).toBe(false);
    expect(canAccessPanel('coach', { ...pro, coachModeAllowed: true })).toBe(true);
    expect(canAccessPanel('settings', free)).toBe(true);
  });

  it('summarises a group by the old page names', () => {
    const opps = NAV_GROUPS.find((g) => g.id === 'opportunities')!;
    expect(groupSummary(opps, pro)).toBe("Today's Intel · Source Feed · Market Dashboard · Federal Grants");
  });
});
