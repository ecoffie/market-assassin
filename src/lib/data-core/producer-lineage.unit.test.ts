import { describe, it, expect } from 'vitest';
import { classifyProducer, LINEAGE_CLAIMS, type LineageClaim } from './producer-lineage';

const find = (key: string) => LINEAGE_CLAIMS.find((c) => c.key === key)!;

describe('C4 — the three initial producer states (completion contract #1)', () => {
  it('naics_vocabulary: a real writer for the real table -> producer_proven', () => {
    const r = classifyProducer(find('naics_vocabulary'));
    expect(r.status).toBe('producer_proven');
    expect(r.provenBy).toBe('scripts/build-naics-vocabulary.ts');
  });

  it('tier2_sblo: documented human curation -> producer_manual (NOT missing)', () => {
    const r = classifyProducer(find('tier2_sblo'));
    expect(r.status).toBe('producer_manual');
    expect(r.detail).toContain('no automated producer');
    expect(r.detail).toContain('manual');
  });

  it('contractors.json: nothing writes it -> producer_missing', () => {
    const r = classifyProducer(find('contractors.json'));
    expect(r.status).toBe('producer_missing');
    // the census evidence: both candidates write somewhere else
    expect(r.detail).toContain('naics-top100.ts');
    expect(r.detail).toContain('/tmp/');
  });
});

describe('C4 — THE SBLO INCIDENT: a superseded scraper can never satisfy proof', () => {
  it('the obsolete scraper does not prove tier2_sblo even though it writes a similar CSV', () => {
    const r = classifyProducer(find('tier2_sblo'));
    // provenBy is null (nothing proved it) — assert that directly rather than
    // .not.toContain, which cannot take null.
    expect(r.provenBy).toBeNull();
    expect(r.status).not.toBe('producer_proven');
  });

  it('naming the superseded scraper as the producer yields MISMATCH, not proven', () => {
    // This is the exact pre-PR-#1444 registry state.
    const claim: LineageClaim = {
      ...find('tier2_sblo'),
      namedProducer: '~/Bootcamp/compile-sblo-list.py',
      manualProcess: null,
    };
    const r = classifyProducer(claim);
    expect(r.status).toBe('producer_mismatch');
    expect(r.detail).toContain('SUPERSEDED');
    expect(r.detail).toContain('must not be run');
  });

  it('even if a superseded producer wrote the EXACT canonical path, it is not proof', () => {
    const claim: LineageClaim = {
      key: 'x', canonicalArtifact: 'src/data/roster.json', namedProducer: null,
      writers: [{ producerPath: 'legacy-scraper.py', writesTo: 'src/data/roster.json', citation: 'test' }],
      supersededProducers: ['legacy-scraper.py'],
    };
    expect(classifyProducer(claim).status).not.toBe('producer_proven');
  });
});

describe('C4 — a NAME is not proof (census class 1/4)', () => {
  it('a named producer that writes a different artifact -> producer_mismatch', () => {
    const claim: LineageClaim = {
      key: 'x', canonicalArtifact: 'src/data/canonical.json',
      namedProducer: 'scripts/importer.js',
      writers: [{ producerPath: 'scripts/importer.js', writesTo: 'src/data/other.json', citation: 'test' }],
    };
    const r = classifyProducer(claim);
    expect(r.status).toBe('producer_mismatch');
    expect(r.detail).toContain('not the canonical');
  });

  it('a named producer with no writer evidence -> mismatch, never proven', () => {
    const claim: LineageClaim = {
      key: 'x', canonicalArtifact: 'src/data/canonical.json',
      namedProducer: 'scripts/plausible-name.js', writers: [],
    };
    const r = classifyProducer(claim);
    expect(r.status).toBe('producer_mismatch');
    expect(r.detail).toContain('a name is not proof');
  });

  it('a downstream importer reading the artifact does not prove production', () => {
    const r = classifyProducer(find('tier2_sblo'));
    // The importer READS the CSV and writes prime-contractors-database.json, so it
    // can never be the roster's producer — provenBy stays null.
    expect(r.provenBy).toBeNull();
    expect(find('tier2_sblo').writers.some(
      (w) => w.producerPath.includes('import-sblo-refresh')
        && w.writesTo === 'src/data/prime-contractors-database.json',
    )).toBe(true);
  });
});

describe('C4 — the four states are NOT collapsed (completion contract)', () => {
  it('manual is distinct from missing', () => {
    expect(classifyProducer(find('tier2_sblo')).status).toBe('producer_manual');
    expect(classifyProducer(find('contractors.json')).status).toBe('producer_missing');
  });

  it('unmeasured is distinct from broken', () => {
    const r = classifyProducer({
      key: 'x', canonicalArtifact: 'a', namedProducer: null, writers: [], evidenceAvailable: false,
    });
    expect(r.status).toBe('producer_unmeasured');
    expect(r.detail).toContain('NOT broken');
  });

  it('manual requires a DOCUMENTED process — "someone made it once" is missing', () => {
    const r = classifyProducer({
      key: 'x', canonicalArtifact: 'a', namedProducer: null, writers: [], manualProcess: null,
    });
    expect(r.status).toBe('producer_missing');
  });
});
