/**
 * The GovCon Action Plan: 27 steps with STABLE IDs. Source of truth: docs/action-plan-2026.md.
 *
 * Mindy Learn cites these IDs on every mission. `action-plan.unit.test.ts` parses the doc and
 * fails if a step here is reworded, reordered, renumbered or dropped.
 */
export type ActionPlanPhase = {
  n: 1 | 2 | 3 | 4 | 5;
  name: string;
  cadence: 'ONCE' | 'REPEAT';
  steps: ReadonlyArray<{ id: string; title: string }>;
};

export const ACTION_PLAN: readonly ActionPlanPhase[] = [
  { n: 1, name: 'Setup', cadence: 'ONCE', steps: [
    { id: 'P1-01', title: 'Choose your Business Structure' },
    { id: 'P1-02', title: 'Identify your Industry codes (NAICS)' },
    { id: 'P1-03', title: 'Create your SAM.GOV Profile' },
    { id: 'P1-04', title: 'Register for Local Gov Sites' },
    { id: 'P1-05', title: 'Talk to Local Apex Accelerator' },
    { id: 'P1-06', title: 'Create/ Fix your Business Resume (Cap Statement)' },
  ] },
  { n: 2, name: 'Business Development', cadence: 'REPEAT', steps: [
    { id: 'P2-01', title: 'Identify Top 25 Buyers & Future Bids (NOT ON SAM)' },
    { id: 'P2-02', title: 'Setup and attend meetings with government buyers' },
    { id: 'P2-03', title: 'Attend Industry Events' },
    { id: 'P2-04', title: 'Attend Site Visits' },
    { id: 'P2-05', title: 'Get on Supplier List for top 25 Federal Suppliers' },
    { id: 'P2-06', title: 'Monitor Contract Awards and Identify Sub Opportunities' },
  ] },
  { n: 3, name: 'Bidding', cadence: 'REPEAT', steps: [
    { id: 'P3-01', title: 'Review Immediate Bid Opportunities' },
    { id: 'P3-02', title: 'Assemble Team Based on Opportunities' },
    { id: 'P3-03', title: 'Apply for Vendor/ Supplier Credit' },
    { id: 'P3-04', title: 'Respond to Opportunity (RFP, RFQ, RFI, Task Orders)' },
    { id: 'P3-05', title: 'Evaluate Bid Results' },
  ] },
  { n: 4, name: 'Business Enhancement', cadence: 'ONCE', steps: [
    { id: 'P4-01', title: 'Apply for Small Business Certification' },
    { id: 'P4-02', title: '8(a) Certification' },
    { id: 'P4-03', title: 'Mentor Protege Program' },
    { id: 'P4-04', title: 'Focus on Self Performance Capability as Differentiator' },
    { id: 'P4-05', title: 'Find Better Partners' },
    { id: 'P4-06', title: 'Speak at an event' },
  ] },
  { n: 5, name: 'Contract Management', cadence: 'REPEAT', steps: [
    { id: 'P5-01', title: 'System Registrations (PIEE, WAWF)' },
    { id: 'P5-02', title: 'Subcontractor Compliance' },
    { id: 'P5-03', title: 'Project Compliance' },
    { id: 'P5-04', title: 'Communication' },
  ] },
];

export const ACTION_PLAN_STEPS = ACTION_PLAN.flatMap((p) => p.steps.map((s) => ({ ...s, phase: p.n, phaseName: p.name, cadence: p.cadence })));

export function actionPlanStep(id: string) {
  return ACTION_PLAN_STEPS.find((s) => s.id === id) ?? null;
}
