'use client';

/**
 * "Start here" card for signed-in visitors on the homepage — where every onboarding finish and
 * sign-in lands (MAPS_HOME_PATH). Steps, copy and state rules: src/lib/onboarding/first-run-guide.ts.
 *
 * Signed-in is the shared account script's verdict (window.__mindySession / the `mindy:session`
 * event, published by PublicHeader's account menu once /api/app/me accepts the token). A signed-out
 * visitor never sees the card.
 */
import { useState, useSyncExternalStore } from 'react';
import {
  FIRST_RUN_GUIDE_KEY,
  FIRST_RUN_STEPS,
  markStepDone,
  parseGuideState,
  shouldShowGuide,
  writeGuideState,
  type FirstRunGuideState,
  type FirstRunStepId,
} from '@/lib/onboarding/first-run-guide';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function FirstRunGuideView({
  state, onStep, onDismiss,
}: {
  state: FirstRunGuideState;
  onStep?: (id: FirstRunStepId) => void;
  onDismiss?: () => void;
}) {
  const doneCount = FIRST_RUN_STEPS.filter((s) => state.done.includes(s.id)).length;
  return (
    <section
      data-testid="first-run-guide"
      aria-labelledby="first-run-guide-title"
      style={{ maxWidth: 1080, margin: '16px auto 0', padding: '0 16px' }}
    >
      <div style={{ border: '1px solid #d6dce6', borderRadius: 14, background: '#fff', padding: '16px 18px', color: 'var(--mp-ink, #0f172a)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 id="first-run-guide-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Start here</h2>
            <p style={{ margin: '2px 0 0', fontSize: 14, color: '#475569' }}>
              Your daily workflow in 3 steps · {doneCount} of {FIRST_RUN_STEPS.length} opened
            </p>
          </div>
          <button
            type="button"
            data-testid="first-run-guide-dismiss"
            onClick={onDismiss}
            style={{ border: 0, background: 'transparent', color: '#475569', fontSize: 14, cursor: 'pointer', padding: 4 }}
          >
            Hide
          </button>
        </div>
        <ol style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {FIRST_RUN_STEPS.map((s, i) => {
            const done = state.done.includes(s.id);
            return (
              <li key={s.id} data-step={s.id} data-done={done ? '1' : '0'}>
                <a
                  href={s.href}
                  onClick={() => onStep?.(s.id)}
                  style={{ display: 'flex', gap: 10, height: '100%', textDecoration: 'none', color: 'inherit', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px' }}
                >
                  <span aria-hidden="true" style={{ flex: 'none', width: 24, height: 24, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, background: done ? '#0a8f57' : 'var(--mp-navy, #1b3a6b)', color: '#fff' }}>
                    {done ? '✓' : i + 1}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{s.title}</span>
                    <span style={{ display: 'block', fontSize: 13, color: '#475569', marginTop: 2 }}>{s.detail}</span>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--mp-navy, #1b3a6b)', marginTop: 6 }}>{s.cta} →</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

// The account script publishes the session verdict on window + a `mindy:session` event.
function subscribeSession(cb: () => void) {
  document.addEventListener('mindy:session', cb);
  return () => document.removeEventListener('mindy:session', cb);
}
const readSession = () => (window as unknown as { __mindySession?: unknown }).__mindySession ?? null;
const noSubscribe = () => () => {};
// Raw string snapshot (stable between renders); parsed below. Guarded: blocked storage reads as empty.
function readStoredRaw(): string | null {
  try { return storage()?.getItem(FIRST_RUN_GUIDE_KEY) ?? null; } catch { return null; }
}
const onServer = () => null;

export default function FirstRunGuide() {
  const session = useSyncExternalStore(subscribeSession, readSession, onServer);
  const storedRaw = useSyncExternalStore(noSubscribe, readStoredRaw, onServer);
  const [local, setLocal] = useState<FirstRunGuideState | null>(null);
  const state = local ?? parseGuideState(storedRaw);

  if (!shouldShowGuide(session, state)) return null;

  const update = (next: FirstRunGuideState) => {
    writeGuideState(storage(), next);
    setLocal(next);
  };

  return (
    <FirstRunGuideView
      state={state}
      onStep={(id) => update(markStepDone(state, id))}
      onDismiss={() => update({ ...state, dismissed: true })}
    />
  );
}
