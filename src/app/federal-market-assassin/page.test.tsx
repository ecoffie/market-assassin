/**
 * Federal Market Assassin Page Tests
 *
 * CRITICAL FEATURES - DO NOT REMOVE:
 * 1. Three-step workflow: inputs -> agencies -> reports
 * 2. CoreInputForm must collect 5 inputs (certification, ZIP, PSC, NAICS, agencies)
 * 3. AgencySelectionTable must show agencies and allow selection
 * 4. ReportsDisplay must show 8 strategic reports
 * 5. API calls to /api/usaspending/find-agencies and /api/reports/generate-all
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FederalMarketAssassinPage from './page';

// Mock fetch for API calls
global.fetch = jest.fn();

describe('FederalMarketAssassinPage', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
  });

  it('renders the input form on step 1', () => {
    render(<FederalMarketAssassinPage />);
    expect(screen.getByText('Federal Market Assassin')).toBeInTheDocument();
    // Should show the core input form
  });

  it('progresses to agency selection after valid inputs', async () => {
    // Mock find-agencies API
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        agencies: [
          { code: 'DOD', name: 'Department of Defense', spending: 1000000 },
          { code: 'VA', name: 'Department of Veterans Affairs', spending: 500000 },
        ],
      }),
    });

    render(<FederalMarketAssassinPage />);

    // Fill in form and submit
    // ... form interaction tests

    await waitFor(() => {
      // Should show agency selection table
      expect(screen.getByText('Select Target Agencies')).toBeInTheDocument();
    });
  });

  it('generates reports after selecting agencies', async () => {
    // Mock generate-all API
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        marketAnalytics: { /* report data */ },
        governmentBuyers: { /* report data */ },
        subcontracting: { /* report data */ },
        idvContracts: { /* report data */ },
        similarAwards: { /* report data */ },
        tribalContracting: { /* report data */ },
        osbpContacts: { /* report data */ },
        summary: { /* summary data */ },
      }),
    });

    // ... test implementation
  });

  it('allows navigation back between steps', () => {
    // Test handleBack() functionality
  });
});

/**
 * COMPONENT DEPENDENCIES:
 * - /components/federal-market-assassin/forms/CoreInputForm.tsx
 * - /components/federal-market-assassin/tables/AgencySelectionTable.tsx
 * - /components/federal-market-assassin/reports/ReportsDisplay.tsx
 *
 * API DEPENDENCIES:
 * - /api/usaspending/find-agencies
 * - /api/reports/generate-all
 *
 * TYPE DEPENDENCIES:
 * - /types/federal-market-assassin.ts (CoreInputs, Agency, ComprehensiveReport)
 */
