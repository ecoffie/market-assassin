import type { TabTipsRegistry } from './types';

// Tab tips for the "more" group. Add entries keyed by panel id (an AppPanel id).
// Each entry must be true for the current code of that panel: read the panel source first.
// Anchors: each [data-tip="..."] matches a data-tip attribute in that panel; Settings' tab row uses its
// existing aria-label. Result, preview and download anchors only exist once that state is showing.
//   grants      → src/components/app/panels/GrantsPanel.tsx
//   dibbs       → src/components/app/panels/DibbsPanel.tsx
//   pricing     → src/components/app/panels/PricingIntelPanel.tsx
//   disa-watch  → src/components/app/panels/DisaVehicleWatchPanel.tsx
//   micc-mrr    → src/components/app/panels/MiccMrrPanel.tsx
//   team        → src/components/app/panels/TeamPanel.tsx
//   settings    → src/components/app/panels/UnifiedSettingsPanel.tsx (+ src/lib/app/settings-tabs.ts)
export const TAB_TIPS: TabTipsRegistry = {
  grants: {
    steps: [
      { text: 'Type a word in the search box (like research or cybersecurity), then press Search or Enter.', anchor: '[data-tip="grants-search"]' },
      { text: 'Narrow it with All Agencies, All Categories and the status menu (Open Now, Forecasted, Closed), then Search again.', anchor: '[data-tip="grants-filters"]' },
      { text: 'Click a grant to open it on Grants.gov. Use Load more at the bottom to see more results.', anchor: '[data-tip="grants-result"]' },
    ],
    tip: 'The buttons at the bottom (SBIR/STTR, Cybersecurity, Research, DOD Grants, HHS Grants) run a quick search. If you see "For me", it sorts by your profile.',
  },
  dibbs: {
    steps: [
      { text: 'Type a keyword or solicitation number, or an NSN or FSC, then press Search.', anchor: '[data-tip="dibbs-search"]' },
      { text: 'Pick a Sort (Soonest deadline or Newest posted). Tick Include expired to see closed requests too.', anchor: '[data-tip="dibbs-sort"]' },
      { text: 'Click a result to open it on DIBBS. "Solicitation PDF" opens the request document when it is shown.', anchor: '[data-tip="dibbs-result"]' },
    ],
    tip: 'DIBBS is where the Defense Logistics Agency asks for quotes on parts. An NSN is a part\'s stock number; an FSC is its 4-digit supply class. No match? Try just the 4-digit FSC.',
  },
  pricing: {
    steps: [
      { text: 'Choose By NAICS (your industry code, like 541512) or By Labor Category (job titles).', anchor: '[data-tip="pricing-mode"]' },
      { text: 'Type the NAICS code, or the roles separated by commas, then press Run Pricing Intel.', anchor: '[data-tip="pricing-query"]' },
      { text: 'Read the Aggressive, Competitive and Premium hourly rates, then the Labor Categories table.', anchor: '[data-tip="pricing-rates"]' },
    ],
    tip: 'Rates come from labor rates on awarded contracts (GSA CALC+). Search the exact job titles you will staff for the closest match.',
  },
  'disa-watch': {
    steps: [
      { text: 'Press Upload CSV and pick your vehicle list (contract number, incumbent, incumbent email, expiry date).', anchor: '[data-tip="disa-watch-upload"]' },
      { text: 'Check Watched Vehicles: each shows its expiry date and how many days are left.', anchor: '[data-tip="disa-watch-vehicles"]' },
      { text: 'Press Preview notices to see the email each due incumbent would get, or download one as .docx.', anchor: '[data-tip="disa-watch-preview"]' },
    ],
    tip: 'Preview is a dry run: nothing is sent. A vehicle with no incumbent email cannot get a notice, so add the email to your spreadsheet and upload it again.',
  },
  'micc-mrr': {
    steps: [
      { text: 'Enter a Requirement title, and a PSC Code and/or NAICS Code. A Keyword is optional.', anchor: '[data-tip="micc-mrr-fields"]' },
      { text: 'Press Generate MRR draft. Mindy fills the data sections from federal award data.', anchor: '[data-tip="micc-mrr-generate"]' },
      { text: 'Review the results, then press Download MRR (.docx) to get the Word file.', anchor: '[data-tip="micc-mrr-download"]' },
    ],
    tip: 'A PSC code says what is being bought (like R425); a NAICS code is the industry. Finish the sections in the "You complete these sections" list yourself.',
  },
  team: {
    steps: [
      { text: 'To add someone, type their email in Invite Seat, pick a role, then press Invite Teammate.', anchor: '[data-tip="team-invite"]' },
      { text: 'In Team Members, an owner or admin can change a person\'s role or press the X to remove them.', anchor: '[data-tip="team-members"]' },
      { text: 'Check Due Soon for next actions due this week, and Team Activity for recent team work.', anchor: '[data-tip="team-due-soon"]' },
    ],
    tip: 'Only owners and admins can invite people. They can also open Workspace Settings to set default NAICS codes that new teammates get.',
  },
  settings: {
    steps: [
      { text: 'Pick a tab at the top, such as Alerts & matching, Profile, Team or Account.', anchor: '[aria-label="Settings sections"]' },
      { text: 'In Alerts & matching, describe what you do and press Suggest codes, then tap the codes to add them.', anchor: '[data-tip="settings-suggest-codes"]' },
      { text: 'Add Target Agencies and States if you want (no states means all states), then press Save Settings.', anchor: '[data-tip="settings-save"]' },
    ],
    tip: 'A dot on a tab means it has changes you have not saved yet. NAICS is your industry and PSC is what the government buys; both shape your alerts.',
  },
};
