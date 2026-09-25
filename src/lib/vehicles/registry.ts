/**
 * Vehicle registry — resolve a vehicle NAME to its VERIFIED parent IDVs. Pure (a checked-in JSON
 * compiled by scripts/verify-vehicle-parents.ts --compile), no network at request time.
 *
 * Every result states how it was established. A name without an authoritative mapping is `unknown`;
 * a name that could mean two vehicles is `ambiguous`; a registered vehicle with no verified members
 * is `unavailable`. None of those ever widens to "all vehicles" — the caller must not query.
 */
import compiled from '@/data/vehicles/vehicle-parents.json';
import { AMBIGUOUS_VEHICLE_NAMES, VEHICLES, normalizeVehicleName, type VehicleDefinition, type VehicleKey } from './definitions';

export interface VehicleMember {
  parent_id: string;
  solicitation_identifier: string;
  recipient_name: string | null;
}

interface CompiledVehicle {
  members: VehicleMember[];
}

interface CompiledRegistry {
  verified_at: string | null;
  source: string;
  candidate_population: string;
  candidates: number;
  /** Candidates whose USASpending record could not be read — membership UNKNOWN, not "no". */
  unresolved_candidates: number;
  vehicles: Partial<Record<VehicleKey, CompiledVehicle>>;
}

const REG = compiled as unknown as CompiledRegistry;

export interface VehicleCoverage {
  verified_at: string | null;
  source: string;
  candidate_population: string;
  candidates_checked: number;
  unresolved_candidates: number;
}

export type VehicleResolution =
  | { status: 'resolved'; requested: string; vehicle: VehicleDefinition; members: VehicleMember[]; coverage: VehicleCoverage }
  | { status: 'unavailable'; requested: string; vehicle: VehicleDefinition; reason: string; coverage: VehicleCoverage }
  | { status: 'ambiguous'; requested: string; reason: string; candidates: string[] }
  | { status: 'unknown'; requested: string; reason: string };

export function vehicleCoverage(): VehicleCoverage {
  return {
    verified_at: REG.verified_at,
    source: REG.source,
    candidate_population: REG.candidate_population,
    candidates_checked: REG.candidates,
    unresolved_candidates: REG.unresolved_candidates,
  };
}

export function registeredVehicleLabels(): string[] {
  return Object.values(VEHICLES).map((v) => v.label);
}

export function resolveVehicle(raw: string): VehicleResolution {
  const requested = String(raw || '').trim();
  const n = normalizeVehicleName(requested);
  const amb = AMBIGUOUS_VEHICLE_NAMES[n];
  if (amb) return { status: 'ambiguous', requested, reason: amb.reason, candidates: amb.candidates };
  const def = Object.values(VEHICLES).find((v) => v.key === n || v.aliases.includes(n));
  if (!def) {
    return {
      status: 'unknown',
      requested,
      reason: `No authoritative mapping for vehicle "${requested}". Registered: ${registeredVehicleLabels().join('; ')}. Pass an exact parent contract id instead.`,
    };
  }
  const members = (REG.vehicles[def.key]?.members ?? []).filter((m) => def.solicitations[m.solicitation_identifier]);
  if (!members.length) {
    return {
      status: 'unavailable',
      requested,
      vehicle: def,
      reason: `${def.label}: no parent IDVs have been verified yet, so its orders cannot be identified.`,
      coverage: vehicleCoverage(),
    };
  }
  return { status: 'resolved', requested, vehicle: def, members, coverage: vehicleCoverage() };
}

/** The verified vehicle a parent belongs to, if any (evidence for a result row). */
export function vehicleOfParent(parentId: string): { key: VehicleKey; label: string; solicitation_identifier: string; pool: string } | null {
  for (const def of Object.values(VEHICLES)) {
    const m = REG.vehicles[def.key]?.members.find((x) => x.parent_id === parentId);
    if (m && def.solicitations[m.solicitation_identifier]) {
      return { key: def.key, label: def.label, solicitation_identifier: m.solicitation_identifier, pool: def.solicitations[m.solicitation_identifier] };
    }
  }
  return null;
}
