import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import PublicShell from '@/components/public-site/PublicShell';
import { COURSE_LIVE } from '@/lib/course/course-live';

/**
 * The free course is not public yet (owner decision 2026-11-18). Every /course page shows a
 * "Coming soon" placeholder instead of its lessons. The switch is COURSE_LIVE in
 * src/lib/course/course-live.ts, shared with every page that links here.
 */

export const metadata: Metadata = COURSE_LIVE ? {} : { robots: { index: false, follow: false } };

function ComingSoon() {
  return (
    <main className="mp-section">
      <div className="mp-container mp-container--prose" style={{ textAlign: 'center', padding: '96px 0' }}>
        <p className="mp-eyebrow mp-eyebrow--accent">Free course</p>
        <h1 className="mp-display">The Federal Contracting Roadmap</h1>
        <p className="mp-standfirst">Coming soon.</p>
        <p className="mp-meta" style={{ marginTop: 16 }}>
          A free, step-by-step course for winning government contracts is on the way.
        </p>
        <p style={{ marginTop: 32 }}>
          <a className="mp-btn mp-btn--primary" href="/">Back to Mindy</a>
        </p>
      </div>
    </main>
  );
}

export default function CourseLayout({ children }: { children: ReactNode }) {
  return <PublicShell contentElement="div">{COURSE_LIVE ? children : <ComingSoon />}</PublicShell>;
}
