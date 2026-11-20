'use client';

/**
 * Counts homepage trial-button clicks (GA4 trial_click, plan pro / monthly) by placement:
 * home_hero, home_steps, home_final. The buttons live in the page's static HTML, so this
 * listens once on the document instead of wiring each one.
 */
import { useEffect } from 'react';
import { trackTrialClick } from '@/lib/ga4';

export default function HomeTrialClicks() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[data-trial]');
      if (a) trackTrialClick('pro', 'monthly', a.getAttribute('data-trial') || 'home');
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  return null;
}
