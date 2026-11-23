import { describe, expect, it } from 'vitest';
import { metadata } from './layout';

// The root layout's metadata is the DEFAULT description / og / twitter text for every public
// route that does not set its own (/signin, /app, ...). It used to claim "24,000+" federal
// opportunities: an unsourced, stale count (active SAM was measured at 36,506 on 2026-09-22).
// A site-wide default must not carry a hard-coded corpus count (CLAUDE.md rule 5).
const og = () => metadata.openGraph as { title?: unknown; description?: unknown };
const tw = () => metadata.twitter as { title?: unknown; description?: unknown };

const texts = (): string[] =>
  [metadata.description, og().description, tw().description, metadata.title, og().title, tw().title].filter(
    (v): v is string => typeof v === 'string',
  );

describe('root layout default metadata (inherited by every route without its own)', () => {
  it('still sets description, og:description and twitter:description', () => {
    expect(metadata.description).toBeTruthy();
    expect(og().description).toBeTruthy();
    expect(tw().description).toBeTruthy();
  });

  it('never states a hard-coded opportunity count', () => {
    for (const t of texts()) {
      expect(t).not.toContain('24,000');
      expect(t).not.toMatch(/\d{1,3}(,\d{3})+\+?/);
    }
  });

  it('keeps the existing positioning copy, minus the number', () => {
    expect(metadata.description).toBe(
      'Mindy scans federal opportunities daily, scores your fit, and tells you which to pursue. The big contractors have armies. You have Mindy.',
    );
    expect(og().description).toBe(
      'Your 24/7 Federal Market Intelligence Analyst. While you sleep, Mindy scans federal opportunities, scores your fit, and tells you what to bid on.',
    );
  });
});
