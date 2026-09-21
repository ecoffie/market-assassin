'use client';
import { useEffect, useRef } from 'react';
import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import type { AppPanel } from './UnifiedSidebar';

/**
 * Interactive product tour (PRD-interactive-product-tour). A guided "click here"
 * walkthrough that DRIVES the app — switches panels, waits for them to mount,
 * spotlights the real controls. v1: 6 core-workflow tabs, show-and-tell (no
 * forced actions, works against empty panels). driver.js engine.
 *
 * Each step optionally has a `panel` — we switch to it and wait for the target
 * selector to exist before highlighting (panels are lazy-loaded).
 */

type TourStep = {
  panel?: AppPanel;          // switch here before highlighting
  element?: string;          // data-tour selector (omit for a centered modal)
  title: string;
  description: string;
};

const STEPS: TourStep[] = [
  {
    title: '👋 Welcome to Mindy',
    description: "Let's take 2 minutes to walk the core workflow — find opportunities, decide what to bid, and draft a response. You can skip anytime (Esc).",
  },
  {
    panel: 'dashboard',
    element: '[data-tour="dash-track"]',
    title: "Today's Intel — your daily feed",
    description: 'Fresh opportunities matched to your profile land here every day. On any card: Review Fit to see why it matches, ＋ Track to add it to your pipeline, or Share it. Tracking is how the whole workflow starts.',
  },
  {
    panel: 'pipeline',
    element: '[data-tour="nav-pipeline"]',
    title: 'My Pursuits — what you\'re working',
    description: 'Everything you Track moves through these stages: tracking → pursuing → bidding → submitted. This is your bid pipeline.',
  },
  {
    panel: 'proposals',
    element: '[data-tour="proposals-mode"]',
    title: 'Proposal Assist — draft a response',
    description: 'Pick a tracked pursuit and Mindy reads the whole solicitation: a bid/no-bid gate, a compliance matrix, grounded draft sections, and an independent compliance check. Auto mode drafts for you; Manual · Sport mode lets you direct it.',
  },
  {
    panel: 'target-list',
    element: '[data-tour="target-add"]',
    title: 'My Target List — agencies you\'re going after',
    description: 'Type an agency name right here to add it to your hit list. Mindy then focuses your decision-makers, relationships, and research around the agencies you pick.',
  },
  {
    panel: 'research',
    element: '[data-tour="nav-research"]',
    title: 'Market Research — your market map',
    description: 'See who buys your NAICS, how much they spend, who holds the work now, and which offices to target. Auto mode runs off your profile; Sport mode lets you research any industry on demand.',
  },
  {
    panel: 'recompetes',
    element: '[data-tour="nav-recompetes"]',
    title: 'Expiring Contracts — recompete + subcontracting targets',
    description: 'Find awards ending soon you can rebid, plus the primes winning task orders in your area to subcontract with. Spot the opening before the next solicitation drops.',
  },
  {
    panel: 'vault',
    element: '[data-tour="vault-tabs"]',
    title: 'My Vault — the profile that powers every draft',
    description: 'Add your capability statement, past performance, key personnel, and resumes under these tabs — once. Mindy pulls from your Vault so drafts use YOUR real info, not placeholders.',
  },
  {
    panel: 'contractors',
    element: '[data-tour="nav-contractors"]',
    title: 'Contractors — partners to team with, primes to beat',
    description: 'Search 3,500+ federal contractors. Find a prime to team with on a bid, or size up the competition.',
  },
  {
    title: "🎉 You're set",
    description: 'That\'s the core loop. Start by Tracking an opportunity from Today\'s Intel, then open Proposal Assist. Replay this tour anytime from Settings.',
  },
];

// Wait for a selector to appear (panels are lazy-loaded after a switch).
function waitForEl(selector: string, timeoutMs = 2500): Promise<Element | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);
    const started = Date.now();
    const iv = setInterval(() => {
      const el = document.querySelector(selector);
      if (el || Date.now() - started > timeoutMs) { clearInterval(iv); resolve(el); }
    }, 100);
  });
}

export default function ProductTour({
  run, onPanelChange, onFinish,
}: {
  run: boolean;
  onPanelChange: (p: AppPanel) => void;
  onFinish: () => void;
}) {
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);

  useEffect(() => {
    if (!run) return;
    let cancelled = false;

    const buildSteps = async (): Promise<DriveStep[]> => STEPS.map((s) => ({
      element: s.element,
      popover: {
        title: s.title,
        description: s.description,
        side: s.element?.includes('nav-') ? 'right' : 'bottom',
        align: 'start',
      },
      onHighlightStarted: async () => {
        // Switch panel + wait for the target before driver highlights it.
        if (s.panel) {
          onPanelChange(s.panel);
          if (s.element) await waitForEl(s.element);
        }
      },
    }));

    (async () => {
      const steps = await buildSteps();
      if (cancelled) return;
      const d = driver({
        showProgress: true,
        progressText: 'Step {{current}} of {{total}}',
        nextBtnText: 'Next →',
        prevBtnText: '← Back',
        doneBtnText: 'Done',
        allowClose: true,
        steps,
        onDestroyed: () => { onFinish(); },
        popoverClass: 'mindy-tour',
      });
      driverRef.current = d;
      // Drive the first step's panel switch, then start.
      const first = STEPS[0];
      if (first.panel) onPanelChange(first.panel);
      d.drive();
    })();

    return () => {
      cancelled = true;
      try { driverRef.current?.destroy(); } catch { /* */ }
    };
  }, [run, onPanelChange, onFinish]);

  return null;
}
