import type { TabTipsRegistry } from './types';

// Written from src/components/app/panels/ForecastsPanel.tsx ("Upcoming Buys").
export const TAB_TIPS: TabTipsRegistry = {
  forecasts: {
    steps: [
      'Fill in one or more filters (NAICS code, Keyword, Agency Override, State or Set-Aside), then press Search. A NAICS code is a number for a type of work, like 541512 for computer systems design.',
      'Click a result to open its details, such as the office and the expected timing, when the agency shared them.',
      'Use the button under "Add to My Pursuits" to keep track of one, or "Open on the map" when it is shown.',
    ],
    tip: 'A forecast is an agency\'s plan to buy something before the solicitation is posted on SAM.gov, so it is a good time to reach out to that office. If you see "Use Saved Profile", it fills the filters from your profile.',
  },
};
