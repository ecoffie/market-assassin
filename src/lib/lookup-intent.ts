/**
 * Global lookup intent — company vs market vs contract ID.
 * Single-word queries like "Excel" are ambiguous: contractor name,
 * product vendor (Microsoft Excel), or federal award keyword.
 */

export interface ContractorHit {
  uei: string;
  company: string;
  slug: string;
  total_contract_value: number;
  state?: string;
}

export interface ProductVendorHint {
  searchQuery: string;
  label: string;
}

/** Product names users often type when they mean the vendor, not a market keyword. */
export const PRODUCT_VENDOR_HINTS: Record<string, ProductVendorHint> = {
  excel: { searchQuery: 'Microsoft', label: 'Microsoft Corporation (Excel software)' },
  word: { searchQuery: 'Microsoft', label: 'Microsoft Corporation (Word)' },
  powerpoint: { searchQuery: 'Microsoft', label: 'Microsoft Corporation (PowerPoint)' },
  outlook: { searchQuery: 'Microsoft', label: 'Microsoft Corporation (Outlook)' },
  sharepoint: { searchQuery: 'Microsoft', label: 'Microsoft Corporation (SharePoint)' },
  windows: { searchQuery: 'Microsoft', label: 'Microsoft Corporation' },
  autocad: { searchQuery: 'Autodesk', label: 'Autodesk (AutoCAD)' },
  salesforce: { searchQuery: 'Salesforce', label: 'Salesforce' },
  oracle: { searchQuery: 'Oracle', label: 'Oracle Corporation' },
  sap: { searchQuery: 'SAP', label: 'SAP' },
};

export function looksLikeUei(q: string): boolean {
  return /^[A-Za-z0-9]{12}$/.test(q.trim());
}

export function looksLikePiid(q: string): boolean {
  const t = q.trim();
  return /^[A-Za-z0-9][A-Za-z0-9-]{6,24}$/.test(t) && /\d/.test(t);
}

/** Multi-word or corp suffix → confident company name. */
export function looksLikeCompany(q: string): boolean {
  const t = q.trim();
  return t.length > 2 && (/\s/.test(t) || /\b(inc|corp|llc|ltd|co|company|group|systems|technolog)\b/i.test(t));
}

/** Could be a contractor OR a market keyword — needs disambiguation. */
export function isAmbiguousLookup(q: string): boolean {
  const t = q.trim();
  if (!t || t.length < 2) return false;
  if (looksLikeUei(t) || looksLikePiid(t) || looksLikeCompany(t)) return false;
  return t.length <= 48;
}

export function getProductVendorHint(query: string): ProductVendorHint | null {
  const key = query.trim().toLowerCase();
  return PRODUCT_VENDOR_HINTS[key] || null;
}

/** True when the contractor name plausibly matches what the user typed. */
export function companyNameMatchesQuery(company: string, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q || q.length < 2) return false;
  const name = company.toLowerCase();
  const words = name.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return true;
  if (q.length >= 4 && words.some((w) => w.includes(q))) return true;
  if (name.startsWith(q)) return true;
  return false;
}

export function filterContractorMatches(contractors: ContractorHit[], query: string): ContractorHit[] {
  return contractors.filter((c) => companyNameMatchesQuery(c.company, query));
}
