/** Fixed Ask Mindy ↔ Claude + MCP parity question set (seed of the spec's 100–200 corpus). */
export const PROBE_QUESTIONS: { id: number; intent: string; q: string }[] = [
  { id: 1, intent: 'CURRENT_FIND', q: "We're RBA Engineering. We do bridge and highway heavy civil construction in Virginia, Maryland and DC. Where are the opportunities?" },
  { id: 2, intent: 'CURRENT_FIND', q: 'What open opportunities are there for janitorial services in Florida?' },
  { id: 3, intent: 'CURRENT_FIND', q: "We're a staffing company in Tennessee (NAICS 561320) with a GSA Schedule offer in process. What should we go after?" },
  { id: 4, intent: 'KNOWN_ID', q: 'Tell me about solicitation N0017426R1003.' },
  { id: 5, intent: 'HISTORICAL', q: 'What happened with the Indian Head MASA solicitation we bid on?' },
  { id: 6, intent: 'LEGISLATION', q: 'Has the FY2026 NDAA become law?' },
];
