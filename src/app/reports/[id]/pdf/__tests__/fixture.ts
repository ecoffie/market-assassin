/** A stored market report with enough rows to span pages. Synthetic names only. */
const contractors = Array.from({ length: 15 }, (_, i) => ({
  name: `Northwind Aerial Systems ${i + 1}`,
  recipient_name: `Northwind Aerial Systems ${i + 1}`,
  amount: 40_000_000 - i * 1_500_000,
  total_obligated: 40_000_000 - i * 1_500_000,
  award_count: 30 - i,
}));

export const REPORT = {
  id: 'abc123abc123abc123abc1',
  owner_email: 'sue@example.com',
  subject: 'drones',
  client_name: 'Acme Corp',
  params: {},
  created_at: '2026-07-16T00:00:00Z',
  payload: {
    subject: 'drones',
    generated_at: '2026-07-16T15:00:00.000Z',
    generated_for: null,
    summary: { subject: 'drones', total_market: 243_000_000, naics_count: 70, top_psc: { code: '1550', name: 'Unmanned Aircraft' }, buying_agencies: 3, top_contractors: 15, recompetes: 0, forecasts: 0 },
    sections: {
      market_size: null,
      top_agencies: [
        { name: 'DEPT OF DEFENSE', sub_agency: 'Navy', contract_count: 12, unique_vendors: 5 },
        { name: 'DEPT OF HOMELAND SECURITY', sub_agency: 'Customs and Border Protection', contract_count: 7, unique_vendors: 3 },
      ],
      competition: { contractors, count: contractors.length },
      recompetes: { contracts: [], count: 0 },
      forecasts: { forecasts: [], count: 0 },
      agency_detail: null,
      set_aside_gap: null,
    },
    _meta: { grounded: true, degraded: false, sections_grounded: 2, sections_total: 7 },
  },
};
