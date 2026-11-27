import type { TabTipsRegistry } from './types';

// Written from src/components/app/panels/ForecastsPanel.tsx ("Upcoming Buys").
// Worked example of anchors: each `anchor` matches a data-tip="..." attribute in that panel. The result
// anchors only exist once a search returned rows; before that the step shows without a highlight.
export const TAB_TIPS: TabTipsRegistry = {
  forecasts: {
    steps: [
      {
        text: 'Fill in one or more filters (NAICS code, Keyword, Agency Override, State or Set-Aside), then press Search. A NAICS code is a number for a type of work, like 541512 for computer systems design.',
        anchor: '[data-tip="forecasts-filters"]',
      },
      {
        text: 'Click a result to open its details, such as the office and the expected timing, when the agency shared them.',
        anchor: '[data-tip="forecasts-result"]',
      },
      {
        text: 'Use the button under "Add to My Pursuits" to keep track of one, or "Open on the map" when it is shown.',
        anchor: '[data-tip="forecasts-track"]',
      },
    ],
    tip: 'A forecast is an agency\'s plan to buy something before the solicitation is posted on SAM.gov, so it is a good time to reach out to that office. If you see "Use Saved Profile", it fills the filters from your profile.',
  },
};
