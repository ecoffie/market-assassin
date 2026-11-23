/**
 * Synthetic documents for the strategy-plan check (fictitious company "Ridgeline Test Facilities LLC"; no real
 * customer, person or record). STRONG follows the benchmark argument; the others are the shapes Eric does not want.
 */
import type { StrategyDocLike } from '../../strategy-plan';

export const STRONG_PLAN: StrategyDocLike = {
  title: 'Ridgeline Test Facilities: Federal Strategy Plan',
  sections: [
    { heading: 'Summary', blocks: [
      { type: 'paragraph', claim: 'fact', text: 'You asked where to focus first. Ridgeline has the work federal facility offices buy but no federal awards yet.' },
      { type: 'paragraph', claim: 'recommendation', text: 'Focus on two VA medical centers and one GSA region, and start with the VA small business office this week.' },
    ] },
    { heading: 'Where Ridgeline stands', blocks: [
      { type: 'table', claim: 'fact', columns: [{ key: 'item', label: 'Item' }, { key: 'detail', label: 'What the record shows' }], rows: [{ item: 'Registration', detail: 'Active in SAM' }, { item: 'Federal awards', detail: 'None yet' }] },
    ] },
    { heading: 'Where to focus', blocks: [
      { type: 'table', claim: 'fact', columns: [{ key: 'buyer', label: 'Buyer' }, { key: 'why', label: 'Why it fits Ridgeline' }, { key: 'door', label: 'Front door' }], rows: [{ buyer: 'VA medical center A', why: 'Buys janitorial and HVAC upkeep under small business set-asides', door: 'VA small business office' }] },
      { type: 'paragraph', claim: 'recommendation', text: 'Lead with the VA: its set-asides match Ridgeline and its current holder ends next spring.' },
    ] },
    { heading: 'Why these and not others', blocks: [
      { type: 'paragraph', claim: 'recommendation', text: 'We set aside the large base operations contracts: they are bundled above Ridgeline\'s size and held by teams of large primes.' },
    ] },
    { heading: 'First moves', blocks: [
      { type: 'table', claim: 'recommendation', columns: [{ key: 'move', label: 'Move' }, { key: 'step', label: 'First step' }, { key: 'why', label: 'Why first' }], rows: [{ move: 'Fix the capability statement', step: 'Add NAICS and PSC codes exactly as in SAM', why: 'Every buyer reads it first' }] },
    ] },
  ],
};

/** The packaged keyword market report: tables with no interpretation, no standing, no moves. */
export const GENERIC_MARKET_REPORT: StrategyDocLike = {
  title: 'Federal Market Report: Janitorial Services',
  sections: [
    { heading: 'Executive summary', blocks: [{ type: 'paragraph', claim: 'fact', text: 'The federal government obligated large sums on janitorial services.' }] },
    { heading: 'Market size', blocks: [{ type: 'table', claim: 'fact', columns: [{ key: 'fy', label: 'Fiscal year' }, { key: 'amt', label: 'Obligated' }], rows: [{ fy: '2026', amt: 1 }] }] },
    { heading: 'Top agencies', blocks: [{ type: 'table', claim: 'fact', columns: [{ key: 'a', label: 'Agency' }, { key: 'amt', label: 'Obligated' }], rows: [{ a: 'VA', amt: 1 }] }] },
    { heading: 'Competition', blocks: [{ type: 'table', claim: 'fact', columns: [{ key: 'v', label: 'Contractor' }, { key: 'amt', label: 'Obligated' }], rows: [{ v: 'X', amt: 1 }] }] },
    { heading: 'Recompetes', blocks: [{ type: 'table', claim: 'fact', columns: [{ key: 'c', label: 'Contract' }, { key: 'end', label: 'Ends' }], rows: [{ c: 'C1', end: '2027-01-01' }] }] },
  ],
};

/** A list of opportunities and a generic action plan: no reasons, no first steps. */
export const LIST_AND_GENERIC_PLAN: StrategyDocLike = {
  title: 'Opportunities for Ridgeline',
  sections: [
    { heading: 'Company profile', blocks: [{ type: 'paragraph', claim: 'fact', text: 'Ridgeline is a small business.' }] },
    { heading: 'Top opportunities', blocks: [{ type: 'table', claim: 'fact', columns: [{ key: 't', label: 'Title' }, { key: 'd', label: 'Deadline' }], rows: [{ t: 'Custodial services', d: '2026-12-01' }] }] },
    { heading: 'Next steps', blocks: [{ type: 'bullets', items: [{ text: 'Network', claim: 'recommendation' }, { text: 'Monitor SAM', claim: 'recommendation' }] }] },
  ],
};
