import type { TabTipsRegistry } from './types';

// Tab tips for the "research" group. Add entries keyed by panel id (an AppPanel id).
// Each entry must be true for the current code of that panel: read the panel source first.
//
// Sources (re-read them before changing a line):
//  map        → src/app/opportunity-map/route.ts (#zsearchInput, Agency/Industry/Filters, the
//               "Open now" horizon menu, Save search) + template.html (card heart "Save to Favorites").
//  watchlist  → src/app/opportunity-map/saved/route.ts (saved-search cards, CTA, the ⋮ menu).
//  saved      → src/app/opportunity-map/favorites/route.ts (filter chips, Start Pursuit, heart).
//  dashboard  → src/components/app/panels/DashboardPanel.tsx (+ TodaysThree, TargetingCard).
//  my-market  → src/components/app/panels/MarketDossierPanel.tsx.
//  alerts     → src/components/app/panels/AlertsPanel.tsx.
//  research   → src/components/app/panels/MarketResearchPanel.tsx.
//  today      → src/components/app/panels/TodayPanel.tsx (shown only while the Today home is on).
export const TAB_TIPS: TabTipsRegistry = {
  map: {
    steps: [
      'Type what you sell in the search box at the top, or pick from the Agency and Industry menus.',
      'Use the "Open now" menu to switch to Coming back or Coming soon. Click a pin or card for details.',
      'Press the heart on a card to save it, or press "Save search" to keep this view and get alerts.',
    ],
    tip: 'Coming back means a contract that is ending and may be bid again (a recompete). Coming soon means an agency forecast, a plan to buy. Filters has more, like an exact NAICS code or a state.',
  },
  watchlist: {
    steps: [
      'Each card is a search you saved with "Save search" on the Map.',
      'Press the button on a card, like "Open Today\'s Lens", to open that search on the Map.',
      'Use the ⋮ menu on a card to Edit its name, Run market report, set Email alerts or Delete it.',
    ],
    tip: 'Email alerts can be set to Daily, Weekly or Off for each saved search, from its ⋮ menu.',
  },
  saved: {
    steps: [
      'This page lists the opportunities you saved with the heart on the Map.',
      'Use the chips at the top, like Needs Attention or Closing Soon, to see one group at a time.',
      'Press "Start Pursuit" to move one to your Pursuits, or press the heart to remove it from Saved.',
    ],
    tip: 'Needs Attention shows saved opportunities that close within 3 days or whose deadline moved since you saved them.',
  },
  dashboard: {
    steps: [
      'Under "Top Opportunities to Review", press Review Fit on a card to see why it may fit you.',
      'Press Track to follow one in your pursuits, or Dismiss to hide it. Use All, Urgent or Teaming to filter.',
      'Inside Review Fit, use the Tune Mindy buttons, like Good match or Not my industry, to give feedback.',
    ],
    tip: 'These picks come from your profile. In "Your targeting", press "Edit codes & keywords" to change your NAICS codes (numbers for types of work) and keywords.',
  },
  'my-market': {
    steps: [
      'Press "Set up my Mindy" to add the agencies buying in your market to your Target List.',
      'Look under "Open now" and "Coming up for recompete". Click a title to open the notice.',
      'Press "Draft response" (or "Draft LOI") to go to Proposals, or Track to go to your pipeline.',
    ],
    tip: 'A recompete is a contract that is ending, so the agency may buy it again. If nothing shows, add your codes and keywords in Settings.',
  },
  alerts: {
    steps: [
      'Use All, Solicitations, Sources Sought, Set-Aside or Due Soon to narrow the list.',
      'Type in the search box, or pick a state or a sort order. Click an opportunity to see its details.',
      'Press Save (or Interested) on a card to keep track of it.',
    ],
    tip: 'Sources Sought means an agency is asking who can do the work before it buys. Your matches follow the NAICS codes, set-asides and states in your profile; change them in Settings.',
  },
  research: {
    steps: [
      'Auto uses your saved profile. Choose Sport to research any industry without changing your settings.',
      'In Sport, describe the work and press "Suggest codes", or type a NAICS or PSC code.',
      'Press "Build Market Map", then pick Market Map, Agency Intel or Competitor Intel under "Choose What You Need".',
    ],
    tip: 'NAICS is a number for a type of work; PSC is a code for the product or service bought. After a report is built, use "Print / PDF" to save it.',
  },
  today: {
    steps: [
      'Check "Your saved searches", or press "Open Watchlist" to see them in full.',
      'Under "Closing soonest", press "Ask Mindy about this" to ask about an opportunity.',
      'Press "Open the Map" to look for more.',
    ],
    tip: 'No saved searches yet? Save a search on the Map, and it will show here each day.',
  },
};
