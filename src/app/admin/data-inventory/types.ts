/** Client-side mirror of the /api/admin/data-inventory response. */

export type Kind = 'source_corpus' | 'derived_intelligence' | 'derived_index' | 'static_manual' | 'passthrough';
export type FreshnessState = 'CURRENT' | 'STALE' | 'UNREACHABLE' | 'STATIC' | 'MANUAL' | 'PASSTHROUGH' | 'UNKNOWN';
export type SurfaceState = 'customer_readable' | 'internal_only' | 'withheld' | 'passthrough';

export interface CountPart { label: string; count: number | null; note?: string }
export interface ScheduleTruth {
  job: string; cron: string | null; enabled: boolean | null;
  lastScheduledRun: { at: string; status: string | null; httpStatus: number | null } | null;
  lastManualRefresh: string | null; nextScheduled: string | null; recurrence: string;
}
export interface InstanceFreshness {
  sourceKey: string; state: FreshnessState; sourceState: string | null; interventionState: string | null;
  heldPopulation: number | null; lastDataAdvance: string | null;
}
export interface Dataset {
  key: string; label: string; kind: Kind; stored: number | null; unit: string; grain?: 'record' | 'transaction';
  served?: { count: number | null; label: string; excluded: CountPart[] };
  breakdown?: CountPart[];
  headlineContribution: number | null; headlineNote?: string;
  freshness: {
    state: FreshnessState; asOf: string | null; basis: string; detail?: string;
    schedules?: ScheduleTruth[]; instances?: InstanceFreshness[];
    ingest?: { status: string; sourceAgeDays: number | null; runAgeDays: number | null; staleAfterDays: number };
  };
  surface: { state: SurfaceState; tools: string[]; app?: string[]; note?: string };
  upstreams: string[]; provenance: string;
  derivedFrom?: string[];
  proseAttributions?: Array<{ label: string; claims: number; livingRecords: number | null }>;
  note?: string;
}

export interface ChangeRow {
  id: number; contract_id: string; piid: string | null; naics_code: string | null;
  field: string; old_value: string | null; new_value: string | null; observed_at: string;
}
export type MoveCounts = Record<'gained' | 'declined' | 'stable' | 'entered' | 'exited', number>;
export interface MovementSummary { counts: MoveCounts; topGainers: Mover[]; topDecliners: Mover[]; comparedLists: number }
export interface Mover { slug: string; uei: string; name: string | null; from: number; to: number; delta: number }

export interface Observation {
  recompeteChanges: {
    total: number | null;
    byField: Array<{ field: string; label: string; count: number | null }>;
    firstObserved: string | null; lastObserved: string | null;
    latest: ChangeRow[] | null;
    series: Array<{ date: string; total: number }> | null;
    basis: string;
  };
  leaderboards: {
    rows: number | null; snapshotDates: string[] | null; latestDate: string | null; previousDate: string | null;
    listsInLatest: number | null; entriesInLatest: number | null;
    movement: MovementSummary | null;
    weekly: Array<{ from: string; to: string; counts: MoveCounts }> | null;
    span: (MovementSummary & { from: string; to: string }) | null;
    basis: string;
  };
  intelligenceChanges: {
    total: number; byType: Array<{ label: string; count: number }>; byDomain: Array<{ label: string; count: number }>;
    firstChanged: string | null; lastChanged: string | null;
    latest: Array<{ agency: string; changeType: string; value: string | null; at: string }>;
    basis: string;
  } | null;
}

export interface InventoryData {
  generatedAt: string;
  datasets: Dataset[];
  totals: {
    ownedSourceRecords: number; transactionRows: number; persistedSourceRows: number;
    unmeasuredSources: string[]; derivedRecords: number;
    staticRecords: number; indexedRepresentations: number; passthroughCapabilities: number;
  };
  upstreams: {
    persisted: string[]; forecastIssuers: string[]; passthroughOnly: string[]; internal: string[];
    total: number; definition: string; names: Record<string, string>; registeredFeeds: number;
  };
  registryDebt: Array<{ where: string; claimed: number; measured: number }>;
  violations: string[];
  observation?: Observation;
  provenanceLimits: Record<string, number | null>;
}
