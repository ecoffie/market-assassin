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
export const TAB_TIPS: TabTipsRegistry = {
  recompetes: {
    steps: [
      'Enter a NAICS code (a number for a type of work), pick "Expiring Within", then press Search.',
      'Click a contract to open its Overview and Capture Notes, such as the incumbent (current holder).',
      'Use "Add to My Pursuits" to track one. Try "Subcontracting (task orders)" to find primes to team with.',
    ],
    tip: 'A recompete is a contract that is ending, so the agency may buy the work again. Watch "days left" and reach out months before it expires.',
  },
  contractors: {
    steps: [
      'Type a Company name, or enter NAICS code(s) (numbers for types of work), then press Search.',
      'Use "Sort by" to order the list by Contract Value, Contract Count or Company Name.',
      'Click a company to open its profile and award history. Use "Open on the map" when it is shown.',
    ],
    tip: 'Not sure where to start? Press one of the "Quick searches" buttons. The State filter works with a name search only, not with NAICS.',
  },
  'decision-makers': {
    steps: [
      'Search by name or title (for example "contracting officer"), then press Search.',
      'Pick an agency, then a sub-agency, to narrow the list. When office rosters are shown, click one to see everyone.',
      'Press Track next to an office to add it to My Target List, or "Open on the map", when you see them.',
    ],
    tip: 'These are people named on SAM.gov notices. "Primary/Secondary POC" means who was listed on a notice, which is not always a job title.',
  },
  contacts: {
    steps: [
      'Under "Find new", pick Gov Buyers, OSBP Directory (small business office reps) or Find Partners.',
      'Search by name or agency, add NAICS or Agency to narrow it, then press "Save to My Network".',
      'Open "My Saved Contacts" to see your people and set where each one stands, from Prospect to Champion.',
    ],
    tip: 'Add agencies to My Target List first. Then you can pick which agency a person belongs to in "Save to agency".',
  },
  'partner-finder': {
    steps: [
      'Choose "Describe the work", type what you need in plain words (or tap an example), then press Find.',
      'Or choose "Complement a firm", paste a contractor UEI (its SAM.gov ID), then press Find.',
      'Press "Save partner" to keep a match, or "Partners like this" to find firms that do nearby work.',
    ],
    tip: 'Matches come from federal award history, not what firms say about themselves. Add a State (like VA) to stay local.',
  },
  'target-list': {
    steps: [
      'Type an agency name in the "Add an agency" box, then click "+ Add" on the match.',
      'On each target, set its status (Targeting, Contacted, Qualified, Passed or Won) and add notes.',
      'Open Contacts or the outreach log on a card, and press "+ Log Activity" after each email or call.',
    ],
    tip: 'Sources sought are notices where an agency asks companies about work it may buy soon. Answering one is an early way to get noticed.',
  },
  'osbp-smb': {
    steps: [
      'Enter a PSC code (a code for the product or service, like J998 ship repair) and/or a NAICS code.',
      'Pick a "Max federal" limit to focus on smaller firms, then press "Find businesses".',
      'Check "Only firms that have won small-business set-aside work" if you need them, then export to CSV.',
    ],
    tip: 'Every result has won federal work before. If you get no matches, try a shorter PSC or NAICS code to widen the search.',
  },
};
