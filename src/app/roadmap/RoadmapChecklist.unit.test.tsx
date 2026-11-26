import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const flag = vi.hoisted(() => ({ live: false }));
vi.mock('@/lib/course/course-live', () => ({
  get COURSE_LIVE() { return flag.live; },
}));

async function renderRoadmap(live: boolean) {
  flag.live = live;
  vi.resetModules();
  const { default: RoadmapChecklist } = await import('./RoadmapChecklist');
  return renderToStaticMarkup(<RoadmapChecklist />);
}

afterEach(() => { flag.live = false; });

describe('/roadmap course links follow the shared COURSE_LIVE flag', () => {
  it('while the course is not live, no link points at the "Coming soon" /course placeholder', async () => {
    const html = await renderRoadmap(false);
    expect(html).not.toMatch(/href="\/course/);
    // hero + one per phase (5) + closing section
    expect(html.match(/\(coming soon\)/g)?.length).toBe(7);
    for (const n of [1, 2, 3, 4, 5]) expect(html).toContain(`Learn Phase ${n} in the free course (coming soon)`);
    expect(html).not.toContain('It takes one minute to start');
  });

  it('once the course is live, every course call to action links to /course/roadmap', async () => {
    const html = await renderRoadmap(true);
    expect(html.match(/href="\/course\/roadmap"/g)?.length).toBe(7);
    expect(html).not.toContain('(coming soon)');
    expect(html).toContain('Learn Phase 2 in the free course →');
  });
});

describe('/course layout reads the same flag', () => {
  it('shows the placeholder while the course is not live', async () => {
    flag.live = false;
    vi.resetModules();
    const { default: CourseLayout } = await import('@/app/course/layout');
    const html = renderToStaticMarkup(<CourseLayout><p>LESSON</p></CourseLayout>);
    expect(html).toContain('Coming soon.');
    expect(html).not.toContain('LESSON');
  });

  it('shows the lessons once the course is live', async () => {
    flag.live = true;
    vi.resetModules();
    const { default: CourseLayout } = await import('@/app/course/layout');
    const html = renderToStaticMarkup(<CourseLayout><p>LESSON</p></CourseLayout>);
    expect(html).toContain('LESSON');
    expect(html).not.toContain('Coming soon.');
  });
});
