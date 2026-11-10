/**
 * Written lesson bodies for the course. Stage lessons share one layout that mirrors a stage of the
 * personalized roadmap: the four fact cards, "when you hit this stage", what to focus on, the
 * Action Plan steps, how you know you are ready, mistakes, and where Mindy helps.
 */
import Link from 'next/link';
import { ROADMAP_STAGES, stageSteps, type CourseLesson, type RoadmapStage } from '@/lib/course/govcon-roadmap';

const FACT_CSS = `
.crs-facts{display:grid;gap:12px;grid-template-columns:repeat(2,minmax(0,1fr))}
.crs-fact{border:1px solid var(--mp-line);border-radius:14px;padding:14px;background:var(--mp-surface)}
.crs-steps{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px}
.crs-steps li{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--mp-hair);border-radius:12px;padding:12px 14px;background:var(--mp-surface)}
.crs-num{flex:0 0 auto;font:600 12px var(--mp-font-mono);color:var(--mp-navy);background:var(--mp-navy-wash);border-radius:8px;padding:4px 7px}
.crs-two{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.crs-list{margin:10px 0 0;padding-left:20px;display:grid;gap:6px;list-style:disc}
ol.crs-list{list-style:decimal}
`;

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mp-label">{label}</p>
      <div style={{ marginTop: 8 }}>{children}</div>
    </section>
  );
}

export function StageLesson({ stage }: { stage: RoadmapStage }) {
  const steps = stageSteps(stage);
  const next = ROADMAP_STAGES.find((s) => s.n === stage.n + 1);
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: FACT_CSS }} />
      <div className="crs-facts">
        {[
          ['Your role', stage.role],
          ['Where you are', stage.bottomLine],
          ['Stage', `${stage.n} of 6`],
          ['Graduate by', stage.graduateBy],
        ].map(([k, v]) => (
          <div className="crs-fact" key={k}>
            <p className="mp-meta">{k}</p>
            <p style={{ marginTop: 6, fontWeight: 600, color: 'var(--mp-ink)', fontSize: 15 }}>{v}</p>
          </div>
        ))}
      </div>

      <Section label={`When you hit Stage ${stage.n}: ${stage.name}`}>
        <p className="mp-prose">{stage.whenYouHit}</p>
      </Section>

      <Section label={`What to focus on at Stage ${stage.n}`}>
        <div style={{ display: 'grid', gap: 14 }}>
          {stage.focus.map((f) => (
            <div key={f.title}>
              <p style={{ fontWeight: 600, color: 'var(--mp-ink)' }}>{f.title}</p>
              <p className="mp-prose" style={{ marginTop: 4 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section label="Your action plan steps">
        <ol className="crs-steps">
          {steps.map((s) => (
            <li key={s.id}>
              <span className="crs-num">{s.id}</span>
              <span style={{ color: 'var(--mp-body)' }}>{s.title}</span>
            </li>
          ))}
        </ol>
      </Section>

      <div className="crs-two">
        <Section label={next ? `You're ready for Stage ${next.n} when` : 'You know you have made it when'}>
          <ul className="crs-list mp-prose">{stage.readyWhen.map((r) => <li key={r}>{r}</li>)}</ul>
        </Section>
        <Section label="Mistakes to avoid">
          <ul className="crs-list mp-prose">{stage.mistakes.map((m) => <li key={m}>{m}</li>)}</ul>
        </Section>
      </div>

      <Section label="Do it with Mindy">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {stage.mindy.map((m) => (
            <Link key={m.href + m.label} href={m.href} className="crs-next">{m.label} →</Link>
          ))}
        </div>
      </Section>
    </>
  );
}

export function StartHereLesson() {
  return (
    <>
      <Section label="What this course is">
        <p className="mp-prose">
          A free, step-by-step roadmap for winning government contracts. It splits federal contracting into
          seven stages, from getting registered to scaling past $1M a year. Each stage tells you what your job is,
          what to focus on, and how you know you are ready for the next one.
        </p>
      </Section>
      <Section label="How to use it">
        <ol className="crs-list mp-prose">
          <li>Watch this lesson and “How federal buying works”.</li>
          <li>Get your personalized roadmap: answer six quick questions and we show you your stage.</li>
          <li>Go to your stage. Do the steps in order.</li>
          <li>When you hit the “ready” signs, move to the next stage.</li>
        </ol>
      </Section>
      <Section label="Three ideas that run through every stage">
        <ul className="crs-list mp-prose">
          <li><b>Most contracts are won before the bid is posted.</b> The buyer already knows who they want to hear from.</li>
          <li><b>Reps beat research.</b> You learn more from submitting one bid than from reading about ten.</li>
          <li><b>Do the stage you are in.</b> Skipping ahead is the most common reason people stall.</li>
        </ul>
      </Section>
    </>
  );
}

export function ContextLesson() {
  return (
    <>
      <Section label="Who buys">
        <p className="mp-prose">
          The government is not one customer. It is thousands of buying offices inside agencies like the Army,
          the VA and GSA. Each office has contracting officers, who sign contracts, and a small business
          specialist, whose job is to help small businesses like yours.
        </p>
      </Section>
      <Section label="Where the work shows up">
        <ul className="crs-list mp-prose">
          <li><b>Open now</b>: bids posted on SAM.gov that you can respond to today.</li>
          <li><b>Coming soon</b>: agency forecasts of what they plan to buy in the next 6–18 months.</li>
          <li><b>Coming back</b>: existing contracts that expire and get bid again (recompetes).</li>
        </ul>
      </Section>
      <Section label="Set-asides">
        <p className="mp-prose">
          Many contracts are set aside so only small businesses, or businesses with a certification such as
          women-owned, veteran-owned, HUBZone or 8(a), can bid. Your size and certifications decide which ones
          you can go after.
        </p>
      </Section>
      <Section label="Prime or sub">
        <p className="mp-prose">
          A prime contractor holds the contract with the government. A subcontractor does part of the work for
          the prime. Many small businesses win their first federal work as a sub.
        </p>
      </Section>
    </>
  );
}

export function FreeBonusLesson() {
  return (
    <>
      <Section label="Your free bonuses">
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="crs-fact">
            <p style={{ fontWeight: 600, color: 'var(--mp-ink)' }}>The 2026 Federal Contracting Action Plan</p>
            <p className="mp-prose" style={{ marginTop: 4 }}>All 27 steps across 5 phases, on one page you can print.</p>
            <a href="/course/2026-Federal-Contracting-Action-Plan.pdf" download className="crs-next" style={{ marginTop: 10 }}>Download the action plan (PDF) →</a>
          </div>
          <div className="crs-fact">
            <p style={{ fontWeight: 600, color: 'var(--mp-ink)' }}>A free Mindy account</p>
            <p className="mp-prose" style={{ marginTop: 4 }}>Daily emails with new contracts that match your business, and the opportunity map.</p>
            <Link href="/app" className="crs-next" style={{ marginTop: 10 }}>Create my free account →</Link>
          </div>
        </div>
      </Section>
    </>
  );
}

export function LessonBody({ lesson }: { lesson: CourseLesson }) {
  if (lesson.stage) return <StageLesson stage={lesson.stage} />;
  if (lesson.slug === 'context') return <ContextLesson />;
  if (lesson.slug === 'free-bonus') return <FreeBonusLesson />;
  return <StartHereLesson />;
}

export function lessonTitle(lesson: CourseLesson): string {
  return lesson.stage ? `Stage ${lesson.stage.n}: ${lesson.stage.name}` : lesson.label;
}
