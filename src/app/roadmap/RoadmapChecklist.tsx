'use client';

/**
 * The live 2027 roadmap: hero, phase strip, a checkable card per step, and a course call to action
 * after every phase. Checkmarks are a per-browser convenience (localStorage), nothing more.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MindyLogo } from '@/components/mindy/MindyLogo';
import { ACTION_PLAN, ACTION_PLAN_STEPS } from '@/lib/learn/action-plan';

const CHECKS_KEY = 'mindy_roadmap_2027_checks';
/** The free course: sign-up, then the personalized stage and the lessons. */
const COURSE_URL = '/course/roadmap';
const TOTAL = ACTION_PLAN_STEPS.length;

const PHASE_TAGS: Record<number, string> = {
  1: 'Foundation & registration',
  2: 'Build relationships & pipeline',
  3: 'Pursue & respond to opportunities',
  4: 'Certifications & growth',
  5: 'Deliver & stay compliant',
};

const CSS = `
.rd-hero{background:var(--mp-navy-wash);border-bottom:1px solid var(--mp-line)}
.rd-in{max-width:900px;margin:0 auto}
.rd-hero .rd-in{padding:28px 0 36px;display:grid;gap:14px}
.rd-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.rd-ed{font:600 12px var(--mp-font-sans);color:var(--mp-navy);border:1px solid var(--mp-line);background:var(--mp-surface);padding:5px 12px;border-radius:999px}
.rd-kicker{font:700 11px var(--mp-font-sans);letter-spacing:.1em;text-transform:uppercase;color:var(--mp-navy);margin:6px 0 0}
.rd-h1{font:700 clamp(2.2rem,6vw,3.8rem)/1.03 var(--mp-font-sans);letter-spacing:-.03em;color:var(--mp-ink);margin:0;max-width:15ch;text-wrap:balance}
.rd-by{display:inline-flex;align-items:center;gap:6px;font:500 15px var(--mp-font-sans);color:var(--mp-navy);margin:0}
.rd-by b{color:var(--mp-ink);font-weight:700}
.rd-lede{font:400 18px/1.5 var(--mp-font-sans);color:var(--mp-body);max-width:54ch;margin:0}
.rd-btns{display:flex;flex-wrap:wrap;gap:10px;margin-top:6px}
.rd-btn{display:inline-flex;align-items:center;padding:13px 22px;border-radius:999px;border:1px solid var(--mp-line);background:var(--mp-surface);color:var(--mp-ink);font:600 15px var(--mp-font-sans);text-decoration:none}
.rd-btn--primary{background:var(--mp-navy);border-color:var(--mp-navy);color:var(--mp-surface)}
.rd-btn--primary:hover{background:var(--mp-navy-hover)}
.rd-flow{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:14px}
.rd-fp{background:var(--mp-surface);border:1px solid var(--mp-line);border-radius:12px;padding:12px;display:grid;gap:6px;align-content:start;justify-items:start;text-decoration:none;color:var(--mp-ink)}
.rd-fp:hover{border-color:var(--mp-navy)}
.rd-fn{font:700 10px var(--mp-font-sans);letter-spacing:.08em;text-transform:uppercase;color:var(--mp-navy)}
.rd-fname{font:700 14px/1.25 var(--mp-font-sans);min-height:2.5em}
.rd-fbar{width:100%;height:4px;background:var(--mp-hair);border-radius:4px;overflow:hidden}
.rd-fbar i{display:block;height:100%;background:var(--mp-ok);transition:width .3s}
@media (max-width:640px){.rd-flow{grid-template-columns:1fr 1fr}.rd-fname{min-height:0}}
.rd-badge{display:inline-block;font:700 10px var(--mp-font-sans);letter-spacing:.08em;padding:3px 10px;border-radius:999px;white-space:nowrap}
.rd-badge--once{background:var(--mp-navy);color:var(--mp-surface)}
.rd-badge--repeat{background:var(--mp-surface);color:var(--mp-navy);border:1px solid var(--mp-navy)}
.rd-body .rd-in{padding:28px 0 72px;display:grid;gap:36px}
.rd-progress{padding:12px 0;border-bottom:1px solid var(--mp-hair);display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.rd-ptxt{font:600 14px var(--mp-font-sans);color:var(--mp-ink);font-variant-numeric:tabular-nums}
.rd-pbar{flex:1;min-width:140px;height:8px;background:var(--mp-hair);border-radius:8px;overflow:hidden}
.rd-pbar i{display:block;height:100%;background:var(--mp-ok);transition:width .3s}
.rd-legend{display:flex;gap:16px;flex-wrap:wrap;align-items:center;font:500 13px var(--mp-font-sans);color:var(--mp-muted);margin-top:-20px}
.rd-phase{display:grid;gap:12px;scroll-margin-top:72px}
.rd-ph{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}
.rd-h2{font:700 clamp(1.6rem,3.6vw,2.1rem)/1.1 var(--mp-font-sans);letter-spacing:-.02em;color:var(--mp-ink);margin:4px 0 0}
.rd-meta{display:flex;align-items:center;gap:10px;font:500 14px var(--mp-font-sans);color:var(--mp-muted);font-variant-numeric:tabular-nums}
.rd-steps{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.rd-step{display:flex;align-items:center;gap:14px;background:var(--mp-surface);border:1px solid var(--mp-line);border-radius:12px;padding:14px 16px;cursor:pointer}
.rd-step input{position:absolute;opacity:0;width:1px;height:1px}
.rd-num{width:36px;height:36px;border-radius:50%;background:var(--mp-navy);color:var(--mp-surface);font:700 13px var(--mp-font-sans);display:flex;align-items:center;justify-content:center;flex:none;font-variant-numeric:tabular-nums}
.rd-txt{flex:1;min-width:0;font:600 15px/1.4 var(--mp-font-sans);color:var(--mp-ink)}
.rd-box{width:22px;height:22px;border:2px solid var(--mp-line);border-radius:6px;flex:none;display:flex;align-items:center;justify-content:center}
.rd-step input:checked~.rd-box{background:var(--mp-ok);border-color:var(--mp-ok)}
.rd-step input:checked~.rd-box::after{content:"✓";font:700 14px var(--mp-font-sans);color:var(--mp-surface)}
.rd-step input:checked~.rd-txt{color:var(--mp-muted);text-decoration:line-through}
.rd-step input:focus-visible~.rd-box{outline:2px solid var(--mp-navy);outline-offset:2px}
.rd-learn{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:var(--mp-navy-wash);border:1px solid var(--mp-line);border-radius:12px;padding:14px 16px;font:500 15px var(--mp-font-sans);color:var(--mp-body)}
.rd-learn a{font:600 15px var(--mp-font-sans);color:var(--mp-navy);text-decoration:none;white-space:nowrap}
.rd-learn a:hover{text-decoration:underline}
.rd-close{background:var(--mp-navy);color:var(--mp-surface);border-radius:16px;padding:30px 28px;display:grid;gap:10px;justify-items:start}
.rd-close h2{font:700 clamp(1.5rem,3.4vw,2rem)/1.15 var(--mp-font-sans);margin:0;color:var(--mp-surface);text-wrap:balance}
.rd-close p{font:400 16px/1.55 var(--mp-font-sans);margin:0;max-width:56ch;color:var(--mp-navy-wash)}
.rd-close .rd-btn{border-color:var(--mp-surface)}
.rd-close .rd-btn--ghost{background:transparent;color:var(--mp-surface)}
@media (prefers-reduced-motion:reduce){.rd-fbar i,.rd-pbar i{transition:none}}
`;

function Badge({ cadence }: { cadence: 'ONCE' | 'REPEAT' }) {
  return (
    <span className={`rd-badge ${cadence === 'ONCE' ? 'rd-badge--once' : 'rd-badge--repeat'}`}>{cadence}</span>
  );
}

export default function RoadmapChecklist() {
  const [checks, setChecks] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try { setChecks(JSON.parse(localStorage.getItem(CHECKS_KEY) || '{}')); } catch { /* storage unavailable */ }
  }, []);

  function toggle(id: string, on: boolean) {
    setChecks((prev) => {
      const next = { ...prev, [id]: on };
      try { localStorage.setItem(CHECKS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  const doneIn = (ids: ReadonlyArray<{ id: string }>) => ids.filter((s) => checks[s.id]).length;
  const done = doneIn(ACTION_PLAN_STEPS);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <section className="rd-hero">
        <div className="mp-container">
          <div className="rd-in">
            <div className="rd-top">
              <p className="rd-kicker" style={{ margin: 0 }}>Free · no sign-up needed</p>
              <span className="rd-ed">2027 Edition</span>
            </div>
            <h1 className="rd-h1">2027 Federal Contracting Roadmap</h1>
            <p className="rd-by">Presented by <MindyLogo size={20} /><b>Mindy</b></p>
            <p className="rd-lede">
              Every step to build a winning federal contracting business: {TOTAL} action items across 5 phases.
              Check them off as you go, and learn how to do each one in the free course.
            </p>
            <div className="rd-btns">
              <Link className="rd-btn rd-btn--primary" href={COURSE_URL}>Learn how in the free course →</Link>
              <a className="rd-btn" href="#phase-1">See the 27 steps</a>
            </div>
            <nav className="rd-flow" aria-label="Phases">
              {ACTION_PLAN.map((p) => (
                <a key={p.n} className="rd-fp" href={`#phase-${p.n}`}>
                  <span className="rd-fn">Phase {p.n}</span>
                  <span className="rd-fname">{p.name}</span>
                  <Badge cadence={p.cadence} />
                  <span className="rd-fbar" aria-hidden="true"><i style={{ width: `${(doneIn(p.steps) / p.steps.length) * 100}%` }} /></span>
                </a>
              ))}
            </nav>
          </div>
        </div>
      </section>

      <div className="rd-body">
        <div className="mp-container">
          <div className="rd-in">
            <div className="rd-progress">
              <span className="rd-ptxt">{done} of {TOTAL} steps done</span>
              <span className="rd-pbar" aria-hidden="true"><i style={{ width: `${(done / TOTAL) * 100}%` }} /></span>
            </div>
            <div className="rd-legend">
              <span><Badge cadence="ONCE" /> Do this phase once</span>
              <span><Badge cadence="REPEAT" /> Repeat it for every opportunity</span>
            </div>

            {ACTION_PLAN.map((p) => (
              <section key={p.n} className="rd-phase" id={`phase-${p.n}`} aria-labelledby={`rd-h-${p.n}`}>
                <div className="rd-ph">
                  <div>
                    <p className="rd-kicker">Phase {p.n} of 5</p>
                    <h2 className="rd-h2" id={`rd-h-${p.n}`}>{p.name}</h2>
                  </div>
                  <div className="rd-meta">
                    <Badge cadence={p.cadence} />
                    <span>{PHASE_TAGS[p.n]}</span>
                    <span>{doneIn(p.steps)}/{p.steps.length}</span>
                  </div>
                </div>
                <ol className="rd-steps">
                  {p.steps.map((s, i) => (
                    <li key={s.id}>
                      <label className="rd-step">
                        <span className="rd-num">{String(i + 1).padStart(2, '0')}</span>
                        <input type="checkbox" id={`rd-${s.id}`} checked={!!checks[s.id]} onChange={(e) => toggle(s.id, e.target.checked)} />
                        <span className="rd-txt">{s.title}</span>
                        <span className="rd-box" aria-hidden="true" />
                      </label>
                    </li>
                  ))}
                </ol>
                <div className="rd-learn">
                  <span>Not sure how to do these steps?</span>
                  <Link href={COURSE_URL}>Learn Phase {p.n} in the free course →</Link>
                </div>
              </section>
            ))}

            <section className="rd-close">
              <h2>You have the steps. Now learn how to do them.</h2>
              <p>
                The free course shows you which stage you are in and walks you through each step with short lessons.
                It takes one minute to start.
              </p>
              <div className="rd-btns">
                <Link className="rd-btn" href={COURSE_URL}>Start the free course →</Link>
                <Link className="rd-btn rd-btn--ghost" href="/">See what Mindy does</Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
