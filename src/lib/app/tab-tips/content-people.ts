import type { TabTipsRegistry } from './types';

// Tab tips for the "people" group. Add entries keyed by panel id (an AppPanel id).
// Each entry must be true for the current code of that panel: read the panel source first.
// Sources (all under src/components/app/panels/):
//   recompetes      -> RecompetesPanel.tsx ("Expiring Contracts")
//   contractors     -> ContractorsPanel.tsx ("Contractors")
//   decision-makers -> GovDecisionMakersPanel.tsx ("Government Decision Makers")
//   contacts        -> RelationshipsPanel.tsx ("Relationships")
//   partner-finder  -> PartnerFinderPanel.tsx ("Partner Finder")
//   target-list     -> MyTargetListPanel.tsx ("My Target List")
//   osbp-smb        -> OsbpSmbResearchPanel.tsx ("Find Capable Small Businesses")
// Anchors: each `anchor` matches a data-tip="..." attribute in that panel (target-list step 1 reuses the
// existing data-tour="target-add" product-tour hook). Anchors on result rows only exist once a search
// returned rows; before that the step shows without a highlight.
export const TAB_TIPS: TabTipsRegistry = {
  recompetes: {
    steps: [
      {
        text: 'Enter a NAICS code (a number for a type of work), pick "Expiring Within", then press Search.',
        anchor: '[data-tip="recompetes-filters"]',
      },
      {
        text: 'Click a contract to open its Overview and Capture Notes, such as the incumbent (current holder).',
        anchor: '[data-tip="recompetes-result"]',
      },
      {
        text: 'Use "Add to My Pursuits" to track one. Try "Subcontracting (task orders)" to find primes to team with.',
        anchor: '[data-tip="recompetes-track"]',
      },
    ],
    tip: 'A recompete is a contract that is ending, so the agency may buy the work again. Watch "days left" and reach out months before it expires.',
  },
  contractors: {
    steps: [
      {
        text: 'Type a Company name, or enter NAICS code(s) (numbers for types of work), then press Search.',
        anchor: '[data-tip="contractors-filters"]',
      },
      {
        text: 'Use "Sort by" to order the list by Contract Value, Contract Count or Company Name.',
        anchor: '[data-tip="contractors-sort"]',
      },
      {
        text: 'Click a company to open its profile and award history. Use "Open on the map" when it is shown.',
        anchor: '[data-tip="contractors-result"]',
      },
    ],
    tip: 'Not sure where to start? Press one of the "Quick searches" buttons. The State filter works with a name search only, not with NAICS.',
  },
  'decision-makers': {
    steps: [
      {
        text: 'Search by name or title (for example "contracting officer"), then press Search.',
        anchor: '[data-tip="decision-makers-search"]',
      },
      {
        text: 'Pick an agency, then a sub-agency, to narrow the list. When office rosters are shown, click one to see everyone.',
        anchor: '[data-tip="decision-makers-agency"]',
      },
      {
        text: 'Press Track next to an office to add it to My Target List, or "Open on the map", when you see them.',
        anchor: '[data-tip="decision-makers-track"]',
      },
    ],
    tip: 'These are people named on SAM.gov notices. "Primary/Secondary POC" means who was listed on a notice, which is not always a job title.',
  },
  contacts: {
    steps: [
      {
        text: 'Under "Find new", pick Gov Buyers, OSBP Directory (small business office reps) or Find Partners.',
        anchor: '[data-tip="contacts-find-new"]',
      },
      {
        text: 'Search by name or agency, add NAICS or Agency to narrow it, then press "Save to My Network".',
        anchor: '[data-tip="contacts-search"]',
      },
      {
        text: 'Open "My Saved Contacts" to see your people and set where each one stands, from Prospect to Champion.',
        anchor: '[data-tip="contacts-saved"]',
      },
    ],
    tip: 'Add agencies to My Target List first. Then you can pick which agency a person belongs to in "Save to agency".',
  },
  'partner-finder': {
    steps: [
      {
        text: 'Choose "Describe the work", type what you need in plain words (or tap an example), then press Find.',
        anchor: '[data-tip="partner-finder-describe"]',
      },
      {
        text: 'Or choose "Complement a firm", paste a contractor UEI (its SAM.gov ID), then press Find.',
        anchor: '[data-tip="partner-finder-complement"]',
      },
      {
        text: 'Press "Save partner" to keep a match, or "Partners like this" to find firms that do nearby work.',
        anchor: '[data-tip="partner-finder-save"]',
      },
    ],
    tip: 'Matches come from federal award history, not what firms say about themselves. Add a State (like VA) to stay local.',
  },
  'target-list': {
    steps: [
      {
        text: 'Type an agency name in the "Add an agency" box, then click "+ Add" on the match.',
        anchor: '[data-tour="target-add"]',
      },
      {
        text: 'On each target, set its status (Targeting, Contacted, Qualified, Passed or Won) and add notes.',
        anchor: '[data-tip="target-list-status"]',
      },
      {
        text: 'Open Contacts or the outreach log on a card, and press "+ Log Activity" after each email or call.',
        anchor: '[data-tip="target-list-outreach"]',
      },
    ],
    tip: 'Sources sought are notices where an agency asks companies about work it may buy soon. Answering one is an early way to get noticed.',
  },
  'osbp-smb': {
    steps: [
      {
        text: 'Enter a PSC code (a code for the product or service, like J998 ship repair) and/or a NAICS code.',
        anchor: '[data-tip="osbp-smb-psc"]',
      },
      {
        text: 'Pick a "Max federal" limit to focus on smaller firms, then press "Find businesses".',
        anchor: '[data-tip="osbp-smb-max"]',
      },
      {
        text: 'Check "Only firms that have won small-business set-aside work" if you need them, then export to CSV.',
        anchor: '[data-tip="osbp-smb-set-aside"]',
      },
    ],
    tip: 'Every result has won federal work before. If you get no matches, try a shorter PSC or NAICS code to widen the search.',
  },
};
