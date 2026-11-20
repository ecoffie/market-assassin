import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dodPortalTopicToRow, fetchDodPortalOpenTopics } from './dod-topics-portal';

const live = JSON.parse(readFileSync(join(__dirname, '__fixtures__/dod-portal-open-topic.json'), 'utf8'));

describe('dodPortalTopicToRow', () => {
  it('maps the live open topic without inventing a description or phase', () => {
    const row = dodPortalTopicToRow(live);
    expect(row).toMatchObject({
      topic_number: 'DAF27TZ01-DV001',
      title: 'AI-Enabled Computed Vision Air-to-Air Refueling Performance Assessment and Automated Pilot Debrief System',
      agency: 'DOD',
      branch: 'USAF',
      program: 'STTR',
      status: 'open',
      solicitation: '27.TZ',
      solicitation_title: 'DoW STTR 2027 BAA',
      phase: null,
      description: null,
      open_date: '2026-10-28',
      close_date: '2026-11-25',
    });
    expect(row!.url).toContain('/topics/api/public/topics/06da7833a5af4981b93c4cfe7dfc0362_86702/details');
  });

  it('drops a hit with no topic code', () => {
    expect(dodPortalTopicToRow({ topicTitle: 'No code' })).toBeNull();
  });
});

describe('fetchDodPortalOpenTopics', () => {
  it('pages until the reported total and treats a 503 as degraded', async () => {
    const page = (n: number) => ({
      total: 2,
      data: [n === 0 ? live : { ...live, topicCode: 'AFX-2', topicTitle: 'Second', topicId: 'id-2' }],
    });
    let calls = 0;
    const fetchImpl = (async () => {
      const body = page(calls);
      calls += 1;
      return new Response(JSON.stringify({ total: 2, data: [body.data[0]] }), { status: 200 });
    }) as typeof fetch;
    const ok = await fetchDodPortalOpenTopics({ fetchImpl, pageSize: 1, maxPages: 4 });
    expect(ok.complete).toBe(true);
    expect(ok.degraded).toBe(false);
    expect(ok.rows.map((r) => r.topic_number)).toEqual(['DAF27TZ01-DV001', 'AFX-2']);
    expect(ok.reportedTotal).toBe(2);

    const down = await fetchDodPortalOpenTopics({
      fetchImpl: (async () => new Response('no', { status: 503 })) as typeof fetch,
      pageSize: 1,
    });
    expect(down.degraded).toBe(true);
    expect(down.complete).toBe(false);
    expect(down.rows).toHaveLength(0);
    expect(down.error).toMatch(/503/);
  });
});
