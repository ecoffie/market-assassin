/**
 * DoD SBIR topic normalization (Eric #6, 2026-07-28). search_sbir was NIH-only (biomedical awards);
 * this parses the official sbir.gov DoD solicitations feed into clean topic rows (number + close date)
 * — the defense gap. The sbir.gov shapes vary across the API's history, so normalizeSolicitation reads
 * several field aliases; these tests lock the parsing against the documented + observed shapes.
 */
import { describe, it, expect } from 'vitest';
import { normalizeSolicitation, type DodSbirTopic } from './dod-sbir';

describe('normalizeSolicitation — API solicitation → topic rows', () => {
  it('flattens a solicitation into its topics, inheriting sol-level agency/program/dates', () => {
    const sol = {
      agency: 'DOD', program: 'SBIR', current_status: 'open',
      solicitation_title: 'DoD SBIR 2026.1', solicitation_number: 'DOD_SBIR_2026_P1',
      open_date: '2026-01-06', close_date: '2026-02-05',
      solicitation_topics: [
        { topic_number: 'A254-001', topic_title: 'Counter-UAS Detection', branch: 'Army', topic_description: 'Detect small UAS.', sbir_topic_link: 'https://x/A254-001' },
        { topic_number: 'N254-002', topic_title: 'EOD Robotics', branch: 'Navy' },
      ],
    };
    const rows = normalizeSolicitation(sol);
    expect(rows).toHaveLength(2);
    const a = rows[0];
    expect(a.topic_number).toBe('A254-001');
    expect(a.title).toBe('Counter-UAS Detection');
    expect(a.branch).toBe('Army');
    expect(a.agency).toBe('DOD');
    expect(a.program).toBe('SBIR');
    expect(a.close_date).toBe('2026-02-05'); // inherited from the solicitation
    expect(a.open_date).toBe('2026-01-06');
    expect(a.status).toBe('open');
    expect(a.solicitation_title).toBe('DoD SBIR 2026.1');
    expect(a.url).toBe('https://x/A254-001');
    // a topic with no title falls back to its number, never blank
    expect(rows[1].title).toBe('EOD Robotics');
  });

  it('reads FIELD ALIASES (number/title, topics vs solicitation_topics) — API shape drift', () => {
    const sol = {
      agency: 'DOD', sbir_sttr: 'STTR', status: 'future',
      topics: [{ number: 'AF254-003', title: 'Hypersonics', description: 'x' }],
    };
    const rows = normalizeSolicitation(sol);
    expect(rows).toHaveLength(1);
    expect(rows[0].topic_number).toBe('AF254-003');
    expect(rows[0].title).toBe('Hypersonics');
    expect(rows[0].program).toBe('STTR');
    expect(rows[0].status).toBe('future');
  });

  it('normalizes M/D/YYYY dates to YYYY-MM-DD', () => {
    const rows = normalizeSolicitation({
      agency: 'DOD', close_date: '2/5/2026', open_date: '1/6/2026',
      solicitation_topics: [{ topic_number: 'X1', topic_title: 'T' }],
    });
    expect(rows[0].close_date).toBe('2026-02-05');
    expect(rows[0].open_date).toBe('2026-01-06');
  });

  it('SKIPS a topic with no number (not citable — never fabricate one)', () => {
    const rows = normalizeSolicitation({
      agency: 'DOD',
      solicitation_topics: [
        { topic_title: 'no number here' },
        { topic_number: '', topic_title: 'blank number' },
        { topic_number: 'OK-1', topic_title: 'good' },
      ],
    });
    expect(rows.map((r: DodSbirTopic) => r.topic_number)).toEqual(['OK-1']);
  });

  it('a solicitation with no topics → []', () => {
    expect(normalizeSolicitation({ agency: 'DOD', solicitation_topics: [] })).toEqual([]);
    expect(normalizeSolicitation({ agency: 'DOD' })).toEqual([]);
  });
});
