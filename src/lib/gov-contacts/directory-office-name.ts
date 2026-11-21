import { createClient } from '@supabase/supabase-js';

/**
 * Name for a buying-office code from dodaac_directory.
 * SAM's current office name wins. The FPDS historical name is the fallback.
 * An empty row stays unnamed. Nothing is invented.
 */
export interface DirectoryOfficeName {
  name: string;
  source: 'sam_office_name' | 'fpds_office_name';
}

/** A stored value that is only the office code is not a name. */
export function nameThatIsNotTheCode(code: string | null | undefined, raw: string | null | undefined): string {
  const name = (raw ?? '').trim();
  if (!name) return '';
  const key = (code ?? '').trim();
  if (key && name.toUpperCase() === key.toUpperCase()) return '';
  return name;
}

export function directoryOfficeName(row: {
  dodaac?: string | null;
  sam_office_name?: string | null;
  office_name?: string | null;
} | null | undefined): DirectoryOfficeName | null {
  const sam = nameThatIsNotTheCode(row?.dodaac, row?.sam_office_name);
  if (sam) return { name: sam, source: 'sam_office_name' };
  const fpds = nameThatIsNotTheCode(row?.dodaac, row?.office_name);
  if (fpds) return { name: fpds, source: 'fpds_office_name' };
  return null;
}

/**
 * Pass 1 can write historical names while the current-name pass throws.
 * That run is not a success. The early-signal score is not a name, so its
 * failure stays in the body and does not flip this verdict.
 */
export function directoryRefreshOutcome(input: {
  samNamesError: string | null;
}): { success: boolean; httpStatus: number; cronOutcome: 'success' | 'partial'; disclosure: string } {
  const disclosure = (input.samNamesError ?? '').slice(0, 500);
  if (!disclosure) return { success: true, httpStatus: 200, cronOutcome: 'success', disclosure: '' };
  return { success: false, httpStatus: 500, cronOutcome: 'partial', disclosure };
}

/**
 * Read names for the codes on this page. A missing credential or a failed read
 * is `failed`, with an empty map — callers leave the office unnamed.
 */
export async function readDirectoryOfficeNames(
  codes: string[],
): Promise<{ names: Map<string, DirectoryOfficeName>; failed: boolean }> {
  const names = new Map<string, DirectoryOfficeName>();
  const unique = [...new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (unique.length === 0) return { names, failed: false };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { names, failed: true };
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await sb
      .from('dodaac_directory')
      .select('dodaac, office_name, sam_office_name')
      .in('dodaac', unique);
    if (error) return { names, failed: true };
    for (const row of (data ?? []) as Array<{ dodaac?: string; office_name?: string | null; sam_office_name?: string | null }>) {
      const named = directoryOfficeName(row);
      if (named && row.dodaac) names.set(row.dodaac.toUpperCase(), named);
    }
    return { names, failed: false };
  } catch {
    return { names, failed: true };
  }
}
