/**
 * Contract-vehicle DEFINITIONS — what a vehicle IS, by authority. Pure data, no I/O.
 *
 * A vehicle is identified by the SOLICITATION(S) its holder IDVs were awarded under, never by a PIID
 * prefix. Measured 2026-09-24: `47QRCA…` is a GSA contracting-office code, and ORIGINAL OASIS holders
 * carry `47QRAD…` PIIDs (CONT_IDV_47QRAD20D1001_4732 → solicitation GS00Q-13-DR-0002). A prefix rule
 * would put original-OASIS orders inside "OASIS+". Membership of a specific parent IDV is established
 * by reading that IDV's own USASpending record (scripts/verify-vehicle-parents.ts), and only a parent
 * whose recorded solicitation is in `solicitations` is a member.
 *
 * Adding a vehicle: cite the issuing agency's published solicitation numbers in `authority`, add it
 * here, re-run the verifier with `--compile`. Never add a vehicle from a guessed or LLM-supplied id.
 */

export type VehicleKey = 'oasis_plus';

export interface VehicleDefinition {
  key: VehicleKey;
  label: string;
  /** Solicitation identifier → pool name, exactly as GSA published them. */
  solicitations: Readonly<Record<string, string>>;
  /** Parent-agency codes (the last slot of CONT_IDV_<piid>_<agency>) the verifier searched. */
  parentAgencies: readonly string[];
  /** Lower-case names that resolve to this vehicle. Matched after normalizeVehicleName(). */
  aliases: readonly string[];
  authority: readonly string[];
}

export const VEHICLES: Readonly<Record<VehicleKey, VehicleDefinition>> = {
  oasis_plus: {
    key: 'oasis_plus',
    label: 'OASIS+ (GSA One Acquisition Solution for Integrated Services Plus)',
    solicitations: {
      '47QRCA23R0001': 'Total Small Business',
      '47QRCA23R0002': '8(a)',
      '47QRCA23R0003': 'HUBZone',
      '47QRCA23R0004': 'SDVOSB',
      '47QRCA23R0005': 'WOSB',
      '47QRCA23R0006': 'Unrestricted',
    },
    parentAgencies: ['4732', '4730', '4740'],
    aliases: ['oasis+', 'oasis plus', 'oasisplus', 'oasis_plus', 'oasis-plus', 'gsa oasis+', 'gsa oasis plus',
      'one acquisition solution for integrated services plus'],
    authority: [
      'https://sam.gov/opp/0e50b6b1d5bd4d0198ab32e73de975b8/view (GSA OASIS+ solicitations 47QRCA23R0001–0006)',
      'Corroborated per IDV: USASpending latest_transaction_contract_data.solicitation_identifier '
        + '(e.g. CONT_IDV_47QRCA25DA002_4732 → 47QRCA23R0002 "OASIS+ 8(A)"; CONT_IDV_47QRCA24DH016_4732 → 47QRCA23R0003 "OASIS+ HUBZONE")',
    ],
  },
};

/**
 * Names that are KNOWN to be a different vehicle, or ambiguous between vehicles. Resolving them to a
 * registered vehicle would be the conflation this module exists to prevent, so they resolve to an
 * explicit `ambiguous` result instead. Original OASIS (solicitation GS00Q-13-DR-0002) is a separate
 * vehicle whose parent set is not registered.
 */
export const AMBIGUOUS_VEHICLE_NAMES: Readonly<Record<string, { reason: string; candidates: string[] }>> = {
  oasis: {
    reason: '"OASIS" can mean the original GSA OASIS vehicle (solicitation GS00Q-13-DR-0002, not registered here) or OASIS+ (a different vehicle). Say "OASIS+" for OASIS+.',
    candidates: ['OASIS+ (registered)', 'original OASIS (not registered)'],
  },
  'gsa oasis': {
    reason: '"GSA OASIS" can mean the original OASIS vehicle (GS00Q-13-DR-0002, not registered here) or OASIS+. Say "OASIS+" for OASIS+.',
    candidates: ['OASIS+ (registered)', 'original OASIS (not registered)'],
  },
  'oasis sb': {
    reason: '"OASIS SB" names an original-OASIS small-business pool, not OASIS+. Original OASIS is not registered here.',
    candidates: ['original OASIS SB (not registered)', 'OASIS+ Total Small Business (say "OASIS+")'],
  },
  'oasis unrestricted': {
    reason: '"OASIS Unrestricted" names an original-OASIS pool, not OASIS+. Original OASIS is not registered here.',
    candidates: ['original OASIS Unrestricted (not registered)', 'OASIS+ Unrestricted (say "OASIS+")'],
  },
};

export function normalizeVehicleName(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
