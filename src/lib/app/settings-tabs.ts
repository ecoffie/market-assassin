/**
 * Settings tabs — which group of cards /app?panel=settings shows, and how a deep link's
 * `section=` picks one.
 *
 * Settings used to be ONE long page (profile, matching, billing, credits, team, security…).
 * It is now split into a few tabs; this module is the pure logic behind that split so the
 * mapping and the URL sync are testable without rendering the panel.
 *
 * Contract:
 *   - Every `section=` value that existed before the split still lands on the tab that holds
 *     that card AND still scrolls to it (credits, billing, notifications, security, team).
 *   - Each tab also has its own `section=` value (matching, profile, billing, team, account).
 *   - Unknown/missing → the default tab.
 */

export const SETTINGS_TABS = [
  { id: 'matching', label: 'Alerts & matching' },
  { id: 'profile', label: 'Profile' },
  { id: 'billing', label: 'Billing & credits' },
  { id: 'team', label: 'Team' },
  { id: 'account', label: 'Account' },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

/**
 * Default = Alerts & matching. Almost every link INTO Settings is about targeting: the map's
 * "Complete your profile / Set up your profile", the trial onboarding email's "Set up my
 * profile", the coming-back-to-market confirm path, Market Intel's "Edit" and the dashboard's
 * targeting card. Display name / role are rarely edited.
 */
export const DEFAULT_SETTINGS_TAB: SettingsTab = 'matching';

/** Every `section=` value the panel understands (old card anchors + one per tab). */
export const SETTINGS_SECTION_VALUES = [
  // tabs
  'matching', 'profile', 'billing', 'team', 'account',
  // older card-level deep links (kept working)
  'credits', 'security', 'notifications', 'alerts',
] as const;

export type SettingsSectionValue = (typeof SETTINGS_SECTION_VALUES)[number];

const SECTION_TO_TAB: Record<SettingsSectionValue, SettingsTab> = {
  matching: 'matching',
  alerts: 'matching',
  profile: 'profile',
  notifications: 'profile',
  billing: 'billing',
  credits: 'billing',
  team: 'team',
  account: 'account',
  security: 'account',
};

/** DOM anchor to scroll to inside the tab. `null` = the tab itself is the target (no scroll). */
const SECTION_TO_ANCHOR: Record<SettingsSectionValue, string | null> = {
  matching: null,
  alerts: null,
  profile: null,
  notifications: 'settings-notifications',
  billing: 'settings-billing',
  credits: 'settings-credits',
  team: 'settings-team',
  account: null,
  security: 'settings-security',
};

export function isSettingsTab(v: unknown): v is SettingsTab {
  return typeof v === 'string' && SETTINGS_TABS.some((t) => t.id === v);
}

export function tabForSection(section: string | null | undefined): SettingsTab {
  const key = (section || '').trim().toLowerCase();
  return (SECTION_TO_TAB as Record<string, SettingsTab>)[key] ?? DEFAULT_SETTINGS_TAB;
}

export function anchorForSection(section: string | null | undefined): string | null {
  const key = (section || '').trim().toLowerCase();
  return (SECTION_TO_ANCHOR as Record<string, string | null>)[key] ?? null;
}

/**
 * The query string after the user switches to `tab` — `section=<tab>`, everything else kept.
 * `tab=` belongs to the Credits console inside Billing & credits (`tab=billing|keys|…`), so it
 * is kept only while that tab is open; carrying it onto another tab would be a stale value.
 */
export function settingsSearchForTab(search: string, tab: SettingsTab): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  params.set('panel', 'settings');
  params.set('section', tab);
  if (tab !== 'billing') params.delete('tab');
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Form fields edited on the Profile tab; everything else in the settings form is matching. */
export const PROFILE_FORM_FIELDS = [
  'display_name',
  'role_title',
  'company_name',
  'email_frequency',
  'alert_recipient_email',
] as const;

/** Fields that are bookkeeping, not user edits — never make a tab "unsaved". */
const IGNORED_FORM_FIELDS = new Set(['onboarding_completed']);

/**
 * Which tabs hold edits that have not been saved yet — drives the "unsaved" dot on the tab
 * bar so switching tabs never hides pending changes.
 */
export function unsavedTabs(
  form: Record<string, unknown>,
  saved: Record<string, unknown> | null,
): Set<SettingsTab> {
  const out = new Set<SettingsTab>();
  if (!saved) return out;
  const profile = new Set<string>(PROFILE_FORM_FIELDS);
  const keys = new Set([...Object.keys(form), ...Object.keys(saved)]);
  for (const k of keys) {
    if (IGNORED_FORM_FIELDS.has(k)) continue;
    if (JSON.stringify(form[k]) === JSON.stringify(saved[k])) continue;
    out.add(profile.has(k) ? 'profile' : 'matching');
  }
  return out;
}
