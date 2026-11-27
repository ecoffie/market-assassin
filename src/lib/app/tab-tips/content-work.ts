import type { TabTipsRegistry } from './types';

// Tab tips for the "work" group. Add entries keyed by panel id (an AppPanel id).
// Each entry must be true for the current code of that panel: read the panel source first.
//
// pipeline  — src/components/app/panels/PipelinePanel.tsx ("My Pursuits", full panel; free users see
//             PipelinePreviewFree and get no box via tabTipsPanelId).
// proposals — src/components/app/panels/ProposalsPanel.tsx + src/components/app/proposal/ProposalHome.tsx
//             (the default 'home' view) + ProposalEditor.tsx (Export).
// vault     — src/components/app/panels/VaultPanel.tsx ("My Vault"). 'library' resolves to these tips.
// knowledge-base — src/components/app/panels/KnowledgeBasePanel.tsx.
// coach     — src/components/app/panels/CoachPanel.tsx ("My Clients").
// chat is intentionally NOT here: MindyChatPanel is a fixed-height (100dvh) panel whose empty state is
// deliberately blank ("no how-to"), so a box above it would push the message input below the fold.
export const TAB_TIPS: TabTipsRegistry = {
  pipeline: {
    steps: [
      'Each card is an opportunity you are tracking. Pick Board to see cards by stage, or List for a table.',
      'Click a card to open its details. Set Stage, Priority and Next Action, add Notes, then press Save Changes.',
      'On a Pursuing, Bidding or Submitted card, press "Draft Proposal" (or "Upload an RFP") to start writing.',
    ],
    tip: 'Use the "Move to" menu on a card to change its stage in one step. "Add by voice" lets you say an opportunity out loud and Mindy adds it for you.',
  },
  proposals: {
    steps: [
      'Click one of your pursuits in the list, or press "+ New proposal" and drop in the RFP (the agency\'s request).',
      'When the documents are loaded, press "Draft my proposal". Mindy writes the sections from them and your Vault.',
      'Review and edit each section in the editor, then use Export to save it as PDF or Word.',
    ],
    tip: 'This is a starting draft, not a finished submission. Add your own proof and check every requirement before you submit on the agency\'s site.',
  },
  vault: {
    steps: [
      'On Identity, press "Auto-fill from UEI" (your 12-character SAM.gov ID) or type your details, then Save Identity.',
      'Use the tabs to add Past Performance (contracts you have won), Capabilities and Key Personnel.',
      'On Documents, upload your capability statement. Mindy reads it into sections you review before saving.',
    ],
    tip: 'The "Vault complete" meter lists what is still missing; press "Add" next to an item to jump to it. Mindy uses your Vault when it writes proposal drafts.',
  },
  'knowledge-base': {
    steps: [
      'Type a topic in "Search the knowledge base" and press Search (or Enter).',
      'Narrow the list with the type buttons, like All or a document type.',
      'Click a document on the left to read its full text on the right.',
    ],
    tip: 'These are the documents Mindy cites in chat. Click a source under an answer to open it here. Some items have a button to watch or listen to the original.',
  },
  coach: {
    steps: [
      'To add a client, type their Business name, paste their capability statement, then press "Add client".',
      'Press "Work as client" on a card. The pipeline, target agencies and research switch to that business.',
      'Press "Exit to my account" when you are done working for that client.',
    ],
    tip: 'Pasting a capability statement lets Mindy pull out their NAICS codes (numbers for types of work) and keywords. To add many at once, press "Bulk add" under "Import a client roster".',
  },
};
