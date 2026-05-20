export interface OpportunityLocationInput {
  popCity?: string | null;
  popState?: string | null;
  popZip?: string | null;
  popCountry?: string | null;
  location?: string | null;
}

export function formatOpportunityLocation(input: OpportunityLocationInput): string {
  const explicit = input.location?.trim();
  if (explicit) return explicit;

  const city = input.popCity?.trim();
  const state = input.popState?.trim();
  const zip = input.popZip?.trim();
  const country = input.popCountry?.trim();

  const cityState = [city, state].filter(Boolean).join(', ');
  const domesticLocation = [cityState, zip].filter(Boolean).join(' ');
  if (domesticLocation) return domesticLocation;
  if (country && country !== 'USA' && country !== 'US') return country;
  return state || '';
}
