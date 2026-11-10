/**
 * /app navigation model — 8 top-level sidebar GROUPS, each holding its old pages as TABS.
 *
 * The sidebar used to list ~21 panels one per row. They are now merged into a handful of
 * groups; the sidebar shows one row per group and the app page renders the group's members
 * as a tab bar above the panel content. NOTHING was removed:
 *   - every panel id (AppPanel) still exists and still renders the same panel component;
 *   - `?panel=<id>` deep links open that exact panel, with its group highlighted and its tab
 *     selected (see `groupForPanel`);
 *   - per-panel tier locks, badges, prototype visibility and the free "data behind glass"
 *     previews are preserved — they now live on the TAB (a locked panel is a locked tab).
 *
 * This module is pure data + pure functions so the sidebar and the tab bar make the same
 * access decision, and so the grouping is unit-testable (nav-groups.unit.test.ts asserts every
 * panel the sidebar used to expose lands in exactly one group).
 */
import {
  type LucideIcon,
  MessageSquare,
  LineChart,
  Bell,
  Compass,
  TrendingUp,
  Target,
  UsersRound,
  DollarSign,
  FileText,
  Telescope,
  Clock,
  Banknote,
  Building2,
  Landmark,
  BookOpen,
  FolderKanban,
  Settings,
  Search,
  Sparkles,
  CalendarClock,
  Trophy,
  CircleUser,
  Shield,
} from 'lucide-react';
import type { AppPanel, AppTier } from './UnifiedSidebar';

/** Everything the old sidebar knew about one panel. Kept verbatim from the pre-grouping
 *  NAV_SECTIONS so tier / badge / prototype / route behaviour does not change. */
export interface NavPanelDef {
  id: AppPanel;
  /** The panel's old sidebar label — still used in the group summary line + tooltips. */
  legacyLabel: string;
  icon: LucideIcon;
  description: string;
  tier: AppTier[];
  badge?: string;
  /** Hidden entirely unless the account is on the prototype allowlist (canSeePrototypes). */
  prototypeOnly?: boolean;
  /** When set, the panel is a full-bleed ROUTE (not part of the panel container): clicking it
   *  navigates there instead of switching the active panel. */
  href?: string;
}

export const NAV_PANELS: Record<string, NavPanelDef> = {
  chat: {
    id: 'chat',
    legacyLabel: 'Mindy Chat',
    icon: MessageSquare,
    description: 'Ask anything, cited sources',
    // Pro-only: Mindy Chat retrieves from the proprietary knowledge base.
    tier: ['pro', 'team', 'enterprise'],
    badge: 'BETA',
  },
  dashboard: {
    id: 'dashboard',
    legacyLabel: "Today's Intel",
    icon: LineChart,
    description: 'AI-prioritized opportunities',
    tier: ['pro', 'team', 'enterprise'],
    badge: 'AI',
  },
  alerts: {
    id: 'alerts',
    legacyLabel: 'Source Feed',
    icon: Bell,
    description: 'Raw SAM.gov matches',
    tier: ['free', 'pro', 'team', 'enterprise'],
  },
  'market-intel': {
    id: 'market-intel',
    legacyLabel: 'Market Dashboard',
    icon: Compass,
    description: 'Charts, full SAM, CSV export',
    tier: ['free', 'pro', 'team', 'enterprise'],
    href: '/app/market-intel',
  },
  grants: {
    id: 'grants',
    legacyLabel: 'Federal Grants',
    icon: Banknote,
    description: 'Grants.gov search',
    tier: ['pro', 'team', 'enterprise'],
  },
  forecasts: {
    id: 'forecasts',
    legacyLabel: 'Upcoming Buys',
    icon: Telescope,
    description: '33,000+ planned',
    tier: ['pro', 'team', 'enterprise'],
  },
  recompetes: {
    id: 'recompetes',
    legacyLabel: 'Expiring Contracts',
    icon: Clock,
    description: 'Recompete targets',
    tier: ['pro', 'team', 'enterprise'],
  },
  'disa-watch': {
    // DISA prototype: IDIQ/IDV expiry tracking + incumbent notification.
    id: 'disa-watch',
    legacyLabel: 'Vehicle Expiry Watch',
    icon: Bell,
    description: 'Auto-notify on expiry',
    tier: ['pro', 'team', 'enterprise'],
    prototypeOnly: true,
  },
  pipeline: {
    id: 'pipeline',
    legacyLabel: 'My Pursuits',
    icon: TrendingUp,
    description: 'Track opportunities',
    tier: ['pro', 'team', 'enterprise'],
  },
  'target-list': {
    id: 'target-list',
    legacyLabel: 'My Target List',
    icon: Target,
    description: 'Saved offices to work',
    tier: ['pro', 'team', 'enterprise'],
  },
  pricing: {
    id: 'pricing',
    legacyLabel: 'Pricing Intel',
    icon: DollarSign,
    description: 'Labor rates, GSA/SCA wages',
    tier: ['pro', 'team', 'enterprise'],
  },
  proposals: {
    id: 'proposals',
    legacyLabel: 'Proposal Assist',
    icon: FileText,
    description: 'AI proposal help — a starting draft, not a final submission',
    tier: ['pro', 'team', 'enterprise'],
    badge: 'BETA',
  },
  research: {
    id: 'research',
    legacyLabel: 'Market Research',
    icon: Compass,
    description: 'Your market map',
    tier: ['free', 'pro', 'team', 'enterprise'],
  },
  contractors: {
    id: 'contractors',
    legacyLabel: 'Contractors',
    icon: Building2,
    description: 'Prime contractor DB',
    tier: ['pro', 'team', 'enterprise'],
  },
  'decision-makers': {
    id: 'decision-makers',
    legacyLabel: 'Decision Makers',
    icon: Landmark,
    description: 'Gov contacts by agency',
    tier: ['pro', 'team', 'enterprise'],
  },
  settings: {
    id: 'settings',
    legacyLabel: 'Settings',
    icon: Settings,
    description: 'Profile, NAICS, security',
    tier: ['free', 'pro', 'team', 'enterprise'],
  },
  vault: {
    id: 'vault',
    legacyLabel: 'My Vault',
    icon: FolderKanban,
    description: 'Your past perf, capabilities, team',
    tier: ['free', 'pro', 'team', 'enterprise'],
  },
  team: {
    id: 'team',
    legacyLabel: 'Team Access',
    icon: UsersRound,
    description: 'Seats + roles',
    tier: ['team', 'enterprise'],
    badge: 'Teams',
  },
  coach: {
    // Coach Mode — manage multiple client businesses. Also open to coachModeAllowed accounts.
    id: 'coach',
    legacyLabel: 'My Clients',
    icon: BookOpen,
    description: 'Manage multiple businesses',
    tier: ['team', 'enterprise'],
    badge: 'Teams',
  },
  'osbp-smb': {
    // Navy OSBP prototype: certified small-biz sourcing.
    id: 'osbp-smb',
    legacyLabel: 'SMB Market Research',
    icon: Search,
    description: 'Certified small-biz sourcing',
    tier: ['pro', 'team', 'enterprise'],
    prototypeOnly: true,
  },
  'micc-mrr': {
    // Government-buyer workspace: dedicated authenticated route (sourced Phase 1 MRR engine).
    id: 'micc-mrr',
    legacyLabel: 'KO Research Workspace',
    icon: FileText,
    description: 'Sourced Phase 1 MRR',
    tier: ['pro', 'team', 'enterprise'],
    prototypeOnly: true,
    href: '/app/market-research',
  },
};

export interface NavGroupMember {
  panel: AppPanel;
  /** Label on the tab across the top of the main area. */
  tab: string;
}

export interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Tabs, in display order. The first ACCESSIBLE one is what a sidebar click opens. */
  members: NavGroupMember[];
  /** Panels that are NOT in the sidebar (no tab) but are still reachable by deep link or
   *  in-panel navigation. When one is active, this group's sidebar row is highlighted. */
  aliases?: AppPanel[];
  /** Kept as a group (deep links, tab bar, highlighting) but NOT shown as a sidebar row. */
  sidebarHidden?: boolean;
}

// The approved grouping (labels are exact — do not reword without sign-off).
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'ask',
    label: 'Ask Mindy',
    icon: Sparkles,
    members: [{ panel: 'chat', tab: 'Mindy Chat' }],
    // Knowledge Base is reached from Mindy Chat citations ("view source").
    aliases: ['knowledge-base'],
  },
  {
    id: 'opportunities',
    label: 'Opportunities',
    icon: LineChart,
    members: [
      { panel: 'dashboard', tab: 'For you' },
      { panel: 'alerts', tab: 'All matches' },
      { panel: 'market-intel', tab: 'Charts & export' },
      { panel: 'grants', tab: 'Grants' },
    ],
    // Market Dossier (post-auto-setup receipt) and the paused DIBBS feed are opportunity views.
    aliases: ['my-market', 'dibbs'],
  },
  {
    id: 'coming-up',
    label: 'Coming up',
    icon: CalendarClock,
    members: [
      { panel: 'forecasts', tab: 'Upcoming buys' },
      { panel: 'recompetes', tab: 'Expiring contracts' },
      { panel: 'disa-watch', tab: 'Vehicle watch' },
    ],
  },
  {
    id: 'pursuits',
    label: 'My Pursuits',
    icon: TrendingUp,
    members: [
      { panel: 'pipeline', tab: 'Opportunities' },
      { panel: 'target-list', tab: 'Offices' },
    ],
  },
  {
    id: 'win',
    label: 'Win the bid',
    icon: Trophy,
    members: [
      { panel: 'pricing', tab: 'Pricing' },
      { panel: 'proposals', tab: 'Proposals' },
    ],
  },
  {
    id: 'research',
    label: 'Market Research',
    icon: Compass,
    members: [{ panel: 'research', tab: 'Market Research' }],
  },
  {
    id: 'players',
    label: 'Players',
    icon: Building2,
    members: [
      { panel: 'contractors', tab: 'Companies' },
      { panel: 'decision-makers', tab: 'Government contacts' },
    ],
    // Relationships ("My Network") and Partner Finder are people/company views.
    aliases: ['contacts', 'partner-finder'],
  },
  {
    id: 'account',
    label: 'Account',
    icon: CircleUser,
    members: [
      { panel: 'vault', tab: 'My Vault' },
      { panel: 'team', tab: 'Team' },
      { panel: 'coach', tab: 'Clients' },
    ],
    // My Library was folded into My Vault's "Generated" tab. Settings is reached ONLY from the
    // top-right account avatar (one way in, Eric 2026-11-09), so it is an alias, not a tab.
    aliases: ['library', 'settings'],
    // Not in the sidebar (Eric, 2026-11-10). Its pages open from Settings → Workspace and the
    // top-right account menu; the group still owns them so deep links show the right tabs.
    sidebarHidden: true,
  },
  {
    // Shown only where its (prototype-only) members are visible — same rule as before.
    id: 'government',
    label: 'For government',
    icon: Shield,
    members: [
      { panel: 'osbp-smb', tab: 'SMB market research' },
      { panel: 'micc-mrr', tab: 'KO research workspace' },
    ],
  },
];

/** Panels a free user may OPEN even though they are Pro: the panel renders a free "data behind
 *  glass" preview (the upgrade CTA lives inside) instead of popping the upgrade modal. */
export const FREE_PREVIEW_PANELS: ReadonlySet<AppPanel> = new Set<AppPanel>([
  'pipeline', 'recompetes', 'forecasts', 'contractors', 'decision-makers',
]);

export interface NavAccessContext {
  userTier: AppTier;
  coachModeAllowed?: boolean;
  canSeePrototypes?: boolean;
}

export function panelDef(panel: AppPanel): NavPanelDef | undefined {
  return NAV_PANELS[panel];
}

/** prototypeOnly panels are HIDDEN (not just locked) unless the account is allowlisted. */
export function isPanelVisible(panel: AppPanel, ctx: NavAccessContext): boolean {
  const def = panelDef(panel);
  if (!def) return false;
  return !def.prototypeOnly || !!ctx.canSeePrototypes;
}

export function canAccessPanel(panel: AppPanel, ctx: NavAccessContext): boolean {
  const def = panelDef(panel);
  if (!def) return false;
  if (def.id === 'coach') return def.tier.includes(ctx.userTier) || !!ctx.coachModeAllowed;
  // Prototype surfaces are gated on the explicit allowlist, NOT tier or staff.
  if (def.prototypeOnly) return !!ctx.canSeePrototypes;
  return def.tier.includes(ctx.userTier);
}

/** The group a panel belongs to — as a tab member, or as a hidden alias. */
export function groupForPanel(panel: AppPanel): NavGroup | undefined {
  return (
    NAV_GROUPS.find((g) => g.members.some((m) => m.panel === panel)) ??
    NAV_GROUPS.find((g) => g.aliases?.includes(panel))
  );
}

export function visibleMembers(group: NavGroup, ctx: NavAccessContext): NavGroupMember[] {
  return group.members.filter((m) => isPanelVisible(m.panel, ctx));
}

/** A group has something to show when at least one of its members is visible. */
export function isGroupVisible(group: NavGroup, ctx: NavAccessContext): boolean {
  return visibleMembers(group, ctx).length > 0;
}

/** A group gets a sidebar row when it is visible and not marked `sidebarHidden`. */
export function isGroupInSidebar(group: NavGroup, ctx: NavAccessContext): boolean {
  return !group.sidebarHidden && isGroupVisible(group, ctx);
}

/** True when none of the group's visible members is accessible (the row shows a lock). */
export function isGroupLocked(group: NavGroup, ctx: NavAccessContext): boolean {
  return !visibleMembers(group, ctx).some((m) => canAccessPanel(m.panel, ctx));
}

/** What a click on the group's sidebar row should open: the first ACCESSIBLE visible member,
 *  else (everything locked) the first visible member, so the existing locked behaviour
 *  — free preview or upgrade modal — applies to it. */
export function primaryMember(group: NavGroup, ctx: NavAccessContext): NavGroupMember | undefined {
  const visible = visibleMembers(group, ctx);
  return visible.find((m) => canAccessPanel(m.panel, ctx)) ?? visible[0];
}

/** One muted line under the sidebar label: the old page names the group now holds, so a user
 *  looking for "Source Feed" still finds it. A single-member group shows its description. */
export function groupSummary(group: NavGroup, ctx: NavAccessContext): string {
  const visible = visibleMembers(group, ctx);
  if (visible.length === 1) return panelDef(visible[0].panel)?.description ?? '';
  return visible.map((m) => panelDef(m.panel)?.legacyLabel ?? m.tab).join(' · ');
}

export type LockedClickAction = 'open' | 'free_preview' | 'upgrade';

/** The same decision the old sidebar made for a per-panel click. */
export function clickActionFor(panel: AppPanel, ctx: NavAccessContext): LockedClickAction {
  if (canAccessPanel(panel, ctx)) return 'open';
  if (ctx.userTier === 'free' && FREE_PREVIEW_PANELS.has(panel)) return 'free_preview';
  return 'upgrade';
}
