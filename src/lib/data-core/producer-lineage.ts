/**
 * C4 — PRODUCER / LINEAGE CONTROL (Data Core Controls, Phase 2)
 *
 * Census trace — four distinct real incidents, not one:
 *   class 1  `tier2_sblo`'s registry named ~/Bootcamp/compile-sblo-list.py, the
 *            SUPERSEDED regex scraper the Jun-2026 roster was created to replace.
 *            Running it would have reintroduced the bad data (PR #1444).
 *   class 4  `import-sblo-refresh.js` was mistaken for the producer; it CONSUMES
 *            the CSV and writes prime-contractors-database.json instead.
 *   class 11 `contractors.json` has NO producer at all — both candidates write
 *            elsewhere (generate-naics-top100.js -> naics-top100.ts;
 *            generate-seo-contractor-candidates.js -> /tmp).
 *   class 2  `sblo-roster-2026-06.json` is real and correct but MANUAL —
 *            "no producer" and "a human produces it" are different facts.
 *
 * THE INVARIANT: a producer is proven only when evidence links
 *     SOURCE -> PRODUCER -> the CANONICAL OUTPUT ARTIFACT.
 * A matching filename, a registry string, a comment, or a downstream importer
 * reading the artifact are NOT proof. That distinction is the entire control:
 * the SBLO incident happened because a plausible-looking name was trusted.
 *
 * This control SURFACES truth. It never rebuilds data, never runs a refresh,
 * and never invents a producer for a dataset that lacks one.
 */

export type ProducerStatus =
  /** Evidence links source -> producer -> this exact artifact. */
  | 'producer_proven'
  /** Produced by a documented HUMAN/agent process. Real, but not automatable today. */
  | 'producer_manual'
  /** No producer exists for the canonical artifact. */
  | 'producer_missing'
  /** A producer is NAMED but writes a different artifact (or a superseded one). */
  | 'producer_mismatch'
  /** Not enough evidence to classify. Never treated as broken. */
  | 'producer_unmeasured';

/** Evidence that a candidate script actually writes a given path. */
export interface WriterEvidence {
  /** Script/function that performs the write. */
  producerPath: string;
  /** The path or table it actually writes — read from the code, not assumed. */
  writesTo: string | null;
  /** Where the claim was verified (e.g. "build-naics-cache.js:34 OUTPUT_PATH"). */
  citation: string;
}

export interface LineageClaim {
  /** data_sources.key or artifact id. */
  key: string;
  /** The artifact/table actually served to customers. */
  canonicalArtifact: string;
  /** What the registry/docs SAY produces it (may be wrong — that is the point). */
  namedProducer: string | null;
  /** Writers discovered by resolving actual write targets. */
  writers: WriterEvidence[];
  /**
   * A documented human/agent process. Set ONLY when a runbook exists; this is
   * what separates `producer_manual` from `producer_missing`.
   */
  manualProcess?: { documentedAt: string; description: string } | null;
  /**
   * Producers known to be SUPERSEDED. A superseded producer can never satisfy
   * proof, even if it writes a similar-looking file — the SBLO incident.
   */
  supersededProducers?: string[];
  /** False when lineage could not be inspected at all (missing repo access, etc). */
  evidenceAvailable?: boolean;
}

export interface ProducerResult {
  key: string;
  status: ProducerStatus;
  /** The writer that satisfied proof, when one did. */
  provenBy: string | null;
  detail: string;
}

/** Normalizes a path for comparison without pretending two names are one file. */
function sameArtifact(a: string | null, b: string): boolean {
  if (!a) return false;
  const norm = (s: string) => s.replace(/^\.\//, '').replace(/^src\//, '').trim();
  return norm(a) === norm(b);
}

/**
 * Classify one dataset's producer lineage.
 *
 * Order encodes the census lessons:
 *   1. No evidence at all            -> producer_unmeasured (never "broken")
 *   2. A writer writes THIS artifact -> producer_proven
 *   3. A documented manual process   -> producer_manual   (real, not missing)
 *   4. A named producer that writes
 *      something else, or is
 *      superseded                    -> producer_mismatch (the SBLO shape)
 *   5. Otherwise                     -> producer_missing
 */
export function classifyProducer(claim: LineageClaim): ProducerResult {
  const superseded = new Set(claim.supersededProducers ?? []);

  if (claim.evidenceAvailable === false) {
    return {
      key: claim.key,
      status: 'producer_unmeasured',
      provenBy: null,
      detail: 'lineage could not be inspected — unknown, NOT broken',
    };
  }

  // 2. Proof: a writer whose ACTUAL output is the canonical artifact.
  // A superseded producer is excluded even if it writes a matching path — the
  // Jun-2026 roster exists precisely because the scraper's output was rejected.
  const proving = claim.writers.find(
    (w) => sameArtifact(w.writesTo, claim.canonicalArtifact) && !superseded.has(w.producerPath),
  );
  if (proving) {
    return {
      key: claim.key,
      status: 'producer_proven',
      provenBy: proving.producerPath,
      detail: `${proving.producerPath} writes ${claim.canonicalArtifact} (${proving.citation})`,
    };
  }

  // 3. Manual is a REAL producer, distinct from missing. Requires a documented
  // process — otherwise "someone made it once" would launder into a status.
  if (claim.manualProcess) {
    return {
      key: claim.key,
      status: 'producer_manual',
      provenBy: null,
      detail:
        `no automated producer; documented manual process (${claim.manualProcess.documentedAt}): `
        + `${claim.manualProcess.description}`,
    };
  }

  // 4. Mismatch: something is NAMED, but it does not produce this artifact.
  if (claim.namedProducer) {
    const named = claim.writers.find((w) => w.producerPath === claim.namedProducer);
    if (superseded.has(claim.namedProducer)) {
      return {
        key: claim.key,
        status: 'producer_mismatch',
        provenBy: null,
        detail:
          `named producer ${claim.namedProducer} is SUPERSEDED and must not be run — `
          + `it does not produce ${claim.canonicalArtifact}`
          + (named?.writesTo ? ` (it writes ${named.writesTo})` : ''),
      };
    }
    if (named && !sameArtifact(named.writesTo, claim.canonicalArtifact)) {
      return {
        key: claim.key,
        status: 'producer_mismatch',
        provenBy: null,
        detail:
          `named producer ${claim.namedProducer} writes ${named.writesTo ?? 'nothing'}, `
          + `not the canonical ${claim.canonicalArtifact}`,
      };
    }
    // Named, but no writer evidence links it anywhere.
    return {
      key: claim.key,
      status: 'producer_mismatch',
      provenBy: null,
      detail:
        `named producer ${claim.namedProducer} could not be shown to write `
        + `${claim.canonicalArtifact} — a name is not proof`,
    };
  }

  // 5. Nothing named, nothing writes it, no documented human process.
  const elsewhere = claim.writers
    .filter((w) => w.writesTo)
    .map((w) => `${w.producerPath} -> ${w.writesTo}`);
  return {
    key: claim.key,
    status: 'producer_missing',
    provenBy: null,
    detail:
      `no producer writes ${claim.canonicalArtifact}`
      + (elsewhere.length ? `; candidates write elsewhere: ${elsewhere.join(', ')}` : ''),
  };
}

/**
 * Phase 2 scope: the three datasets whose canonical role the P0 decisions
 * established (docs/data-core-p0-decisions-approved.md). Deliberately NOT every
 * dataset — each entry below is a different producer STATE, which is what proves
 * the control distinguishes them.
 */
export const LINEAGE_CLAIMS: LineageClaim[] = [
  {
    key: 'tier2_sblo',
    canonicalArtifact: 'src/data/sblo-roster-2026-06.json',
    namedProducer: null, // corrected by PR #1444; previously the superseded scraper
    writers: [
      {
        producerPath: 'scripts/import-sblo-refresh.js',
        writesTo: 'src/data/prime-contractors-database.json',
        citation: 'import-sblo-refresh.js:145 writeFileSync(DB_PATH) — a CONSUMER of the CSV (class 4)',
      },
      {
        producerPath: '~/Bootcamp/compile-sblo-list.py',
        writesTo: '~/Bootcamp/sblo-list-compiled.csv',
        citation: 'compile-sblo-list.py:277 output_file — different filename AND schema (sblo_name, no vendorPortal)',
      },
    ],
    manualProcess: {
      documentedAt: 'docs/DATA-SOURCES-REGISTRY.md §SBLO lineage (PR #1444)',
      description:
        'SBA Prime Directory roster -> manual cleaning to 200 legal names -> '
        + 'manual/agent-assisted live-source contact research (Jun 2026)',
    },
    supersededProducers: ['~/Bootcamp/compile-sblo-list.py'],
  },
  {
    key: 'contractors.json',
    canonicalArtifact: 'src/data/contractors.json',
    namedProducer: null,
    writers: [
      {
        producerPath: 'scripts/generate-naics-top100.js',
        writesTo: 'src/data/naics-top100.ts',
        citation: 'generate-naics-top100.js:160 const target',
      },
      {
        producerPath: 'scripts/generate-seo-contractor-candidates.js',
        writesTo: '/tmp/mi-seo-contractor-candidates.json',
        citation: 'generate-seo-contractor-candidates.js:7 OUT_JSON',
      },
    ],
    manualProcess: null,
    supersededProducers: [],
  },
  {
    key: 'naics_vocabulary',
    canonicalArtifact: 'naics_vocabulary',
    namedProducer: 'scripts/build-naics-vocabulary.ts',
    writers: [
      {
        producerPath: 'scripts/build-naics-vocabulary.ts',
        writesTo: 'naics_vocabulary',
        citation: 'build-naics-vocabulary.ts writes the naics_vocabulary table; refreshed_at 2026-07-11 on all rows',
      },
    ],
    manualProcess: null,
    supersededProducers: [],
  },
];
