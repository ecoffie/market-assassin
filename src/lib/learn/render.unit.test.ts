/**
 * The public Learn pages: what they show, and what they must never show while progress does not exist.
 */
import { describe, it, expect } from 'vitest';
import { ACTION_PLAN_STEPS } from './action-plan';
import { MISSIONS, missionById } from './missions';
import { learnIndexHtml, libraryItems, missionHtml } from './render';
import { GET as indexGET } from '@/app/learn/route';
import { GET as missionGET, generateStaticParams } from '@/app/learn/[slug]/route';

const INDEX = learnIndexHtml();
/** Visible text only: drop scripts, styles, tags and the search haystack attributes. */
const visible = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/data-h="[^"]*"/g, '').replace(/<[^>]+>/g, ' ');

describe('/learn index', () => {
  it('is in the shared public shell (same header as the Maps / public pages)', () => {
    expect(INDEX).toContain('class="mp-head"');
    expect(INDEX).toContain('class="mp-foot"');
    expect(INDEX).toContain('<link rel="canonical" href="https://getmindy.ai/learn">');
  });
  it('shows Beginner, Intermediate and Advanced prominently, After the Win as a later stage', () => {
    const order = ['Learn the Game', 'Play the Game', 'Win the Game', 'After the Win'].map((n) => INDEX.indexOf(`<h2>${n}</h2>`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(INDEX).toContain('<section class="stage later" id="after">');
  });
  it('links every mission, and has the Tutorial Library and all 27 steps', () => {
    for (const m of MISSIONS) expect(INDEX).toContain(`href="/learn/${m.slug}"`);
    expect(INDEX).toContain('Tutorial Library');
    for (const s of ACTION_PLAN_STEPS) expect(visible(INDEX)).toContain(s.id);
  });
  it('shows no progress: no checkmark, no percent, no "completed"', () => {
    const v = visible(INDEX);
    expect(v).not.toMatch(/✓|✔|\d+\s?%|\bcompleted?\b/i);
  });
  it('never says Playbook', () => {
    expect(INDEX).not.toMatch(/playbook/i);
  });
});

describe('Tutorial Library search data', () => {
  const items = libraryItems();
  const find = (q: string) => items.filter((it) => q.toLowerCase().split(/\s+/).every((t) => it.haystack.includes(t)));
  it('covers every mission and all 27 Action Plan steps', () => {
    expect(items).toHaveLength(MISSIONS.length + 27);
  });
  it('finds by step ID, term and topic', () => {
    expect(find('P2-01').map((i) => i.key)).toEqual(expect.arrayContaining(['B2', 'B3', 'I1', 'I6', 'P2-01']));
    expect(find('sources sought').map((i) => i.key)).toContain('A1');
    expect(find('incumbent').map((i) => i.key)).toContain('I2');
    expect(find('coming back').map((i) => i.key)).toContain('B4');
  });
  it('Outside Mindy steps carry their principle and no tutorial link', () => {
    const p101 = items.find((i) => i.key === 'P1-01')!;
    expect(p101.text).toMatch(/^Outside Mindy\./);
    expect(p101.href).toBeNull();
  });
});

describe('/learn/<slug> mission pages', () => {
  it('B1 renders every approved field', () => {
    const h = missionHtml(missionById('B1')!);
    for (const t of ['What you’ll learn', 'Why it matters', 'A practical example', 'Truth rule', 'What Mindy can do', 'Step by step', 'Terms']) expect(h).toContain(t);
    expect(h).toContain('href="/welcome/company?next=/learn"');
    expect(h).toContain('Action Plan: P1-02 Identify your Industry codes (NAICS)');
    expect(h).toContain('Free · sign in');
    expect(h).toContain('href="/learn/see-your-three-horizons"');
  });
  it('a Coming next mission has no Do-it button and says so', () => {
    const h = missionHtml(missionById('I6')!);
    expect(h).not.toContain('class="btn"');
    expect(h).toContain('Coming next.');
  });
  it('an After the Win step has no Do-it button and says Outside Mindy', () => {
    const h = missionHtml(missionById('W1')!);
    expect(h).not.toContain('class="btn"');
    expect(h).toContain('Outside Mindy.');
  });
  it('a Pro mission shows the label without claiming a block', () => {
    const h = missionHtml(missionById('A1')!);
    expect(h).toContain('class="tag pro">Pro<');
    expect(h).toContain('class="btn"');
  });
  it('no mission page shows a progress checkmark (B5 quotes the Saved button label only)', () => {
    for (const m of MISSIONS) {
      const v = visible(missionHtml(m)).replace('✓ Saved — alerts on', '');
      expect(v, m.id).not.toMatch(/✓|✔|\bcompleted\b/i);
    }
  });
  it('escapes copy (no raw quotes breaking attributes)', () => {
    expect(missionHtml(missionById('B3')!)).not.toMatch(/content="[^"]*"[^ >\/]/);
  });
});

describe('routes', () => {
  it('GET /learn → 200 HTML', async () => {
    const r = indexGET();
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/html/);
  });
  it('every mission slug is pre-generated and returns 200; unknown → 404', async () => {
    expect(generateStaticParams().map((p) => p.slug)).toEqual(MISSIONS.map((m) => m.slug));
    for (const m of MISSIONS) {
      const r = await missionGET(new Request('https://getmindy.ai/x'), { params: Promise.resolve({ slug: m.slug }) });
      expect(r.status, m.slug).toBe(200);
    }
    const nf = await missionGET(new Request('https://getmindy.ai/x'), { params: Promise.resolve({ slug: 'nope' }) });
    expect(nf.status).toBe(404);
  });
});
