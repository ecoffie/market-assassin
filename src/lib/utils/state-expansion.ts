/**
 * Smart State Expansion for GovCon Opportunities
 *
 * When a user selects a state, we automatically expand to include:
 * 1. The selected state
 * 2. All bordering states
 * 3. DC (always included - federal contracts)
 *
 * This maximizes opportunity coverage since:
 * - Many contracts span multiple states
 * - Place of performance can be flexible
 * - Remote work is common in federal contracting
 */

// State border relationships (bidirectional)
export const STATE_BORDERS: Record<string, string[]> = {
  AL: ['FL', 'GA', 'MS', 'TN'],
  AK: [], // No land borders
  AZ: ['CA', 'CO', 'NM', 'NV', 'UT'],
  AR: ['LA', 'MO', 'MS', 'OK', 'TN', 'TX'],
  CA: ['AZ', 'NV', 'OR'],
  CO: ['AZ', 'KS', 'NE', 'NM', 'OK', 'UT', 'WY'],
  CT: ['MA', 'NY', 'RI'],
  DE: ['MD', 'NJ', 'PA'],
  DC: ['MD', 'VA'], // Washington DC
  FL: ['AL', 'GA'],
  GA: ['AL', 'FL', 'NC', 'SC', 'TN'],
  HI: [], // No land borders
  ID: ['MT', 'NV', 'OR', 'UT', 'WA', 'WY'],
  IL: ['IA', 'IN', 'KY', 'MO', 'WI'],
  IN: ['IL', 'KY', 'MI', 'OH'],
  IA: ['IL', 'MN', 'MO', 'NE', 'SD', 'WI'],
  KS: ['CO', 'MO', 'NE', 'OK'],
  KY: ['IL', 'IN', 'MO', 'OH', 'TN', 'VA', 'WV'],
  LA: ['AR', 'MS', 'TX'],
  ME: ['NH'],
  MD: ['DC', 'DE', 'PA', 'VA', 'WV'],
  MA: ['CT', 'NH', 'NY', 'RI', 'VT'],
  MI: ['IN', 'OH', 'WI'],
  MN: ['IA', 'ND', 'SD', 'WI'],
  MS: ['AL', 'AR', 'LA', 'TN'],
  MO: ['AR', 'IA', 'IL', 'KS', 'KY', 'NE', 'OK', 'TN'],
  MT: ['ID', 'ND', 'SD', 'WY'],
  NE: ['CO', 'IA', 'KS', 'MO', 'SD', 'WY'],
  NV: ['AZ', 'CA', 'ID', 'OR', 'UT'],
  NH: ['MA', 'ME', 'VT'],
  NJ: ['DE', 'NY', 'PA'],
  NM: ['AZ', 'CO', 'OK', 'TX', 'UT'],
  NY: ['CT', 'MA', 'NJ', 'PA', 'VT'],
  NC: ['GA', 'SC', 'TN', 'VA'],
  ND: ['MN', 'MT', 'SD'],
  OH: ['IN', 'KY', 'MI', 'PA', 'WV'],
  OK: ['AR', 'CO', 'KS', 'MO', 'NM', 'TX'],
  OR: ['CA', 'ID', 'NV', 'WA'],
  PA: ['DE', 'MD', 'NJ', 'NY', 'OH', 'WV'],
  RI: ['CT', 'MA'],
  SC: ['GA', 'NC'],
  SD: ['IA', 'MN', 'MT', 'ND', 'NE', 'WY'],
  TN: ['AL', 'AR', 'GA', 'KY', 'MO', 'MS', 'NC', 'VA'],
  TX: ['AR', 'LA', 'NM', 'OK'],
  UT: ['AZ', 'CO', 'ID', 'NM', 'NV', 'WY'],
  VT: ['MA', 'NH', 'NY'],
  VA: ['DC', 'KY', 'MD', 'NC', 'TN', 'WV'],
  WA: ['ID', 'OR'],
  WV: ['KY', 'MD', 'OH', 'PA', 'VA'],
  WI: ['IA', 'IL', 'MI', 'MN'],
  WY: ['CO', 'ID', 'MT', 'NE', 'SD', 'UT'],
};

// Regional groupings for broader searches
export const REGIONS: Record<string, string[]> = {
  'Northeast': ['CT', 'MA', 'ME', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT'],
  'Southeast': ['AL', 'FL', 'GA', 'KY', 'MS', 'NC', 'SC', 'TN', 'VA', 'WV'],
  'Midwest': ['IA', 'IL', 'IN', 'KS', 'MI', 'MN', 'MO', 'ND', 'NE', 'OH', 'SD', 'WI'],
  'Southwest': ['AZ', 'NM', 'OK', 'TX'],
  'West': ['CA', 'CO', 'ID', 'MT', 'NV', 'OR', 'UT', 'WA', 'WY'],
  'Mid-Atlantic': ['DC', 'DE', 'MD', 'NJ', 'NY', 'PA', 'VA'],
  'Pacific': ['AK', 'CA', 'HI', 'OR', 'WA'],
  'Mountain': ['AZ', 'CO', 'ID', 'MT', 'NM', 'NV', 'UT', 'WY'],
};

// State names for display
export const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'Washington DC', FL: 'Florida',
  GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana',
  IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
  MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin',
  WY: 'Wyoming',
};

/**
 * Get the region a state belongs to
 */
export function getRegionForState(state: string): string | null {
  for (const [region, states] of Object.entries(REGIONS)) {
    if (states.includes(state.toUpperCase())) {
      return region;
    }
  }
  return null;
}

/**
 * Expand a single state to include border states
 * Always includes DC for federal contract coverage
 */
export function expandStateToBorders(state: string): string[] {
  const stateUpper = state.toUpperCase();
  const borders = STATE_BORDERS[stateUpper] || [];

  // Start with the selected state
  const expanded = new Set<string>([stateUpper]);

  // Add all bordering states
  borders.forEach(s => expanded.add(s));

  // Always include DC for federal contracts
  expanded.add('DC');

  return Array.from(expanded).sort();
}

/**
 * Expand a state to include its entire region
 */
export function expandStateToRegion(state: string): string[] {
  const stateUpper = state.toUpperCase();
  const region = getRegionForState(stateUpper);

  if (!region) {
    // Fallback to border expansion
    return expandStateToBorders(stateUpper);
  }

  const regionStates = new Set<string>(REGIONS[region]);

  // Always include DC
  regionStates.add('DC');

  return Array.from(regionStates).sort();
}

/**
 * Smart expansion with configurable depth:
 * - 'state': Just the selected state + DC
 * - 'borders': Selected state + bordering states + DC (default)
 * - 'region': Entire region + DC
 * - 'nationwide': All states (no filter)
 */
export function expandStateForSearch(
  state: string | null | undefined,
  depth: 'state' | 'borders' | 'region' | 'nationwide' = 'borders'
): string[] | null {
  // No state selected = nationwide (return null to not filter)
  if (!state || state.trim() === '') {
    return null;
  }

  const stateUpper = state.toUpperCase().trim();

  // Validate state code
  if (!STATE_NAMES[stateUpper]) {
    console.warn(`[StateExpansion] Invalid state code: ${state}`);
    return null;
  }

  switch (depth) {
    case 'state':
      return [stateUpper, 'DC'];

    case 'borders':
      return expandStateToBorders(stateUpper);

    case 'region':
      return expandStateToRegion(stateUpper);

    case 'nationwide':
      return null;

    default:
      return expandStateToBorders(stateUpper);
  }
}

/**
 * Get a human-readable description of the expansion
 */
export function describeStateExpansion(state: string | null | undefined, depth: 'state' | 'borders' | 'region' | 'nationwide' = 'borders'): string {
  if (!state || state.trim() === '') {
    return 'Searching nationwide';
  }

  const stateUpper = state.toUpperCase().trim();
  const stateName = STATE_NAMES[stateUpper];

  if (!stateName) {
    return 'Searching nationwide';
  }

  const expanded = expandStateForSearch(state, depth);

  if (!expanded) {
    return 'Searching nationwide';
  }

  if (depth === 'state') {
    return `${stateName} only + DC`;
  }

  if (depth === 'borders') {
    const others = expanded.filter(s => s !== stateUpper && s !== 'DC');
    if (others.length === 0) {
      return `${stateName} + DC`;
    }
    return `${stateName} + ${others.length} bordering states + DC`;
  }

  if (depth === 'region') {
    const region = getRegionForState(stateUpper);
    return `${region} region (${expanded.length} states)`;
  }

  return 'Searching nationwide';
}

// Example usage:
// expandStateForSearch('FL', 'borders') => ['AL', 'DC', 'FL', 'GA']
// expandStateForSearch('FL', 'region') => ['AL', 'DC', 'FL', 'GA', 'KY', 'MS', 'NC', 'SC', 'TN', 'VA', 'WV']
// expandStateForSearch(null) => null (nationwide)
