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

export function directoryOfficeName(row: {
  sam_office_name?: string | null;
  office_name?: string | null;
} | null | undefined): DirectoryOfficeName | null {
  const sam = row?.sam_office_name?.trim() ?? '';
  if (sam) return { name: sam, source: 'sam_office_name' };
  const fpds = row?.office_name?.trim() ?? '';
  if (fpds) return { name: fpds, source: 'fpds_office_name' };
  return null;
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
