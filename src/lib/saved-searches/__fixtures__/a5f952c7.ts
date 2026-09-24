/**
 * Saved search a5f952c7 — the locked acceptance case for the Forecast migration (#1664 / #1672).
 * Filters copied verbatim from production `saved_searches.filters` on 2026-09-23 (read-only).
 * Accepted canonical reading at #1672: Forecast 3,578 (legacy 3,586 before the Navy fragment leak was
 * removed), coverage PARTIAL, COMMERCE named missing.
 */
export const A5F952C7_FILTERS = {
  naics: '541511,541512,541513,541519,621,622,623',
  agency: 'VETERANS AFFAIRS|INTERIOR|HOMELAND SECURITY|AGRICULTURE|HEALTH AND HUMAN SERVICES|STATE, DEPARTMENT|JUSTICE|COMMERCE|NATIONAL AERONAUTICS|GENERAL SERVICES|ENERGY|TRANSPORTATION|LABOR|ENVIRONMENTAL PROTECTION|TREASURY',
  horizons: { open: false, forecast: true, recompete: true },
};

export const A5F952C7_COVERED = [
  'VETERANS AFFAIRS', 'INTERIOR', 'HOMELAND SECURITY', 'AGRICULTURE', 'HEALTH AND HUMAN SERVICES',
  'STATE, DEPARTMENT', 'JUSTICE', 'NATIONAL AERONAUTICS', 'GENERAL SERVICES', 'ENERGY', 'TRANSPORTATION',
  'LABOR', 'ENVIRONMENTAL PROTECTION', 'TREASURY',
];
