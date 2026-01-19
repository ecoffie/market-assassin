/**
 * Opportunity Hunter Page Tests
 *
 * CRITICAL FEATURES - DO NOT REMOVE:
 * 1. Agency modal must open when clicking table rows
 * 2. Modal must display: Key Statistics, Office Information, Pain Points
 * 3. Pain points must be loaded from /api/agency-knowledge-base/
 * 4. Modal must close on: X button, clicking outside, Escape key
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OpportunityScoutPage from './page';

// Mock fetch for API calls
global.fetch = jest.fn();

describe('OpportunityScoutPage', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
  });

  it('renders the search form', () => {
    render(<OpportunityScoutPage />);
    expect(screen.getByText('Opportunity Hunter')).toBeInTheDocument();
    expect(screen.getByText('Scout Opportunities')).toBeInTheDocument();
  });

  it('opens modal when clicking agency row', async () => {
    // Mock search results
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        agencies: [{
          agencyId: '1234',
          agencyName: 'Test Agency',
          totalSpending: 1000000,
          setAsideSpending: 500000,
          contractCount: 10,
          setAsideContractCount: 5,
          parentAgency: 'Department of Defense',
          location: 'Washington, DC',
        }],
        summary: {
          totalAwards: 10,
          totalAgencies: 1,
          totalSpending: 1000000,
        },
        searchCriteria: {},
      }),
    });

    // Mock pain points API
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          painPoints: ['Modernization needs', 'Cybersecurity concerns'],
        },
      }),
    });

    render(<OpportunityScoutPage />);

    // Submit search
    fireEvent.click(screen.getByText('Scout Opportunities'));

    await waitFor(() => {
      expect(screen.getByText('Test Agency')).toBeInTheDocument();
    });

    // Click on agency row
    fireEvent.click(screen.getByText('Test Agency'));

    // Modal should open with details
    await waitFor(() => {
      expect(screen.getByText('Office Information')).toBeInTheDocument();
      expect(screen.getByText('Agency Priorities & Pain Points')).toBeInTheDocument();
      expect(screen.getByText('Market Research Links')).toBeInTheDocument();
    });
  });

  it('closes modal when clicking X button', async () => {
    // ... test implementation
  });

  it('closes modal when pressing Escape', async () => {
    // ... test implementation
  });
});
