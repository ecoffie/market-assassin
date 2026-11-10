/**
 * The course page frame: "START HERE" header, lesson rail on the left, video + lesson in the middle,
 * one side card on the right. Same pattern on every lesson (getmindy.ai/course/<lesson>).
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { COURSE_LESSONS, nextLesson, type CourseLesson } from '@/lib/course/govcon-roadmap';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT } from '@/lib/events/lazy-contractors-blueprint';

const CSS = `
.crs-hero{padding:48px 0 28px;text-align:center}
.crs-grid{display:grid;gap:24px;grid-template-columns:240px minmax(0,1fr) 260px;align-items:start;padding-bottom:72px}
@media (max-width:1080px){.crs-grid{grid-template-columns:220px minmax(0,1fr)}.crs-side{grid-column:1/-1}}
@media (max-width:760px){.crs-grid{grid-template-columns:minmax(0,1fr)}.crs-rail{order:2}}
.crs-rail{background:var(--mp-surface);border:1px solid var(--mp-line);border-radius:16px;padding:16px 10px}
.crs-rail ol{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:2px}
.crs-rail a{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;color:var(--mp-body);text-decoration:none;font-size:14px}
.crs-rail a:hover{background:var(--mp-wash)}
.crs-rail a[aria-current="page"]{background:var(--mp-navy-wash);color:var(--mp-navy);font-weight:600;box-shadow:inset 2px 0 0 var(--mp-navy)}
.crs-badge{flex:0 0 auto;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:600;background:var(--mp-wash);color:var(--mp-muted)}
a[aria-current="page"] .crs-badge{background:var(--mp-navy);color:#FFFFFF}
.crs-mark{margin-left:auto;font-size:11px;color:var(--mp-subtle);white-space:nowrap}
.crs-video{aspect-ratio:16/9;border-radius:16px;border:1px solid var(--mp-line);background:var(--mp-navy-wash);display:grid;place-items:center;text-align:center;overflow:hidden}
.crs-video iframe{width:100%;height:100%;border:0}
.crs-play{width:64px;height:64px;border-radius:50%;background:var(--mp-navy);display:grid;place-items:center;margin:0 auto 12px}
.crs-bar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-top:18px}
.crs-next{display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:999px;border:1px solid var(--mp-line);background:var(--mp-surface);color:var(--mp-ink);font-size:14px;font-weight:600;text-decoration:none}
.crs-next:hover{border-color:var(--mp-navy);color:var(--mp-navy)}
.crs-cta{display:block;margin-top:18px;padding:16px 20px;border-radius:999px;background:var(--mp-navy);color:#FFFFFF;text-align:center;font-size:17px;font-weight:600;text-decoration:none}
.crs-cta:hover{background:var(--mp-navy-hover)}
.crs-side{background:var(--mp-surface);border:1px solid var(--mp-line);border-radius:16px;padding:20px}
.crs-body{margin-top:32px;display:grid;gap:28px}
`;

function VideoSlot({ url, title }: { url?: string; title: string }) {
  if (url) {
    return (
      <div className="crs-video">
        <iframe src={url} title={title} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
      </div>
    );
  }
  return (
    <div className="crs-video" role="img" aria-label={`${title} video coming soon`}>
      <div>
        <div className="crs-play" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="#FFFFFF"><path d="M8 5v14l11-7z" /></svg>
        </div>
        <p className="mp-label">Video coming soon</p>
        <p className="mp-meta" style={{ marginTop: 6 }}>The written lesson is below.</p>
      </div>
    </div>
  );
}

/** True until the end of the event day (ET). Pages revalidate hourly, so the card switches within an hour. */
function eventStillAhead(now: number = Date.now()): boolean {
  return now < Date.parse(`${EVENT.iso}T23:59:59-05:00`);
}

function SideCard() {
  const eventOpen = eventStillAhead();
  if (eventOpen) {
    return (
      <aside className="crs-side">
        <p className="mp-eyebrow mp-eyebrow--accent">Free live event · {EVENT.shortDate}</p>
        <p className="mp-title" style={{ marginTop: 10, fontSize: 20 }}>{EVENT.title}</p>
        <p className="mp-meta" style={{ marginTop: 8 }}>{EVENT.dateLabel} · {EVENT.timeLabel} · Online</p>
        <Link href={EVENT.path} className="crs-next" style={{ marginTop: 14 }}>Save my free seat →</Link>
      </aside>
    );
  }
  return (
    <aside className="crs-side">
      <p className="mp-eyebrow mp-eyebrow--accent">Free with Mindy</p>
      <p className="mp-title" style={{ marginTop: 10, fontSize: 20 }}>See the contracts that fit your business</p>
      <p className="mp-meta" style={{ marginTop: 8 }}>Daily alerts and the opportunity map are free.</p>
      <Link href="/opportunity-map" className="crs-next" style={{ marginTop: 14 }}>Open the map →</Link>
    </aside>
  );
}

export default function CoursePlayer({
  lesson, title, videoUrl, children,
}: { lesson: CourseLesson; title: string; videoUrl?: string; children: ReactNode }) {
  const next = nextLesson(lesson.slug);
  return (
    <main>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="mp-container">
        <header className="crs-hero">
          <p className="mp-eyebrow mp-eyebrow--accent">Free course · Start here</p>
          <h1 className="mp-display" style={{ marginTop: 10 }}>The Federal Contracting Roadmap</h1>
          <p className="mp-standfirst" style={{ marginTop: 12 }}>
            Find your stage. Learn what to do next. Win your first, or next, government contract.
          </p>
        </header>

        <div className="crs-grid">
          <nav className="crs-rail" aria-label="Course lessons">
            <p className="mp-label" style={{ padding: '0 10px' }}>The roadmap</p>
            <ol>
              {COURSE_LESSONS.map((l) => (
                <li key={l.slug}>
                  <Link href={l.slug === 'start-here' ? '/course' : `/course/${l.slug}`} aria-current={l.slug === lesson.slug ? 'page' : undefined}>
                    <span className="crs-badge" aria-hidden="true">{l.badge}</span>
                    <span>{l.label}</span>
                    {l.marker && <span className="crs-mark">{l.marker}</span>}
                  </Link>
                </li>
              ))}
            </ol>
          </nav>

          <div style={{ minWidth: 0 }}>
            <VideoSlot url={videoUrl} title={title} />
            <div className="crs-bar">
              <h2 className="mp-title" style={{ fontSize: 24 }}>{title}</h2>
              {next && (
                <Link className="crs-next" href={`/course/${next.slug}`}>Next: {next.label} →</Link>
              )}
            </div>
            <Link className="crs-cta" href="/course/roadmap">Get my personalized GovCon roadmap</Link>
            <div className="crs-body">{children}</div>
          </div>

          <SideCard />
        </div>
      </div>
    </main>
  );
}
