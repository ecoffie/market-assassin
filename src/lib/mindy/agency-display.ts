export interface BuyerAgencyInput {
  agency?: string | null;
  department?: string | null;
  subTier?: string | null;
  sub_tier?: string | null;
  office?: string | null;
}

function cleanAgencyPart(value?: string | null) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeAgencyPart(value?: string | null) {
  return cleanAgencyPart(value).toLowerCase();
}

function isDifferent(value?: string | null, compareTo?: string | null) {
  const normalizedValue = normalizeAgencyPart(value);
  const normalizedCompare = normalizeAgencyPart(compareTo);
  return Boolean(normalizedValue) && normalizedValue !== normalizedCompare;
}

export function getBuyerAgencyParts(input: BuyerAgencyInput) {
  const department = cleanAgencyPart(input.department || input.agency);
  const subTier = cleanAgencyPart(input.subTier || input.sub_tier);
  const office = cleanAgencyPart(input.office);
  const primary = subTier || office || department || 'Unknown agency';
  const secondary = isDifferent(office, primary) ? office : '';
  const parent = isDifferent(department, primary) ? department : '';

  return {
    primary,
    secondary,
    parent,
    full: [primary, secondary, parent].filter(Boolean).join(' • '),
  };
}

export function getBuyerAgencyLabel(input: BuyerAgencyInput) {
  return getBuyerAgencyParts(input).primary;
}
