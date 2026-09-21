/**
 * /today shares badly — and it is already a live, shareable page.
 *
 * MEASURED on prod 2026-08-16, getmindy.ai/ vs getmindy.ai/today:
 *   tag              apex   /today
 *   title/desc        ✅      ✅
 *   canonical         ✅      ❌
 *   og:* (5 tags)     ✅      ❌
 *   twitter:*         ✅      ❌
 *   JSON-LD           ✅      ❌
 * So every share of /today — Slack, LinkedIn, iMessage — renders as a bare link with no title
 * card and no image. That matters NOW (the page is live and gets shared), and it is the thing
 * that would break if the apex ever pointed here: PRD-map-as-homepage lists "SEO organic traffic
 * not regressed" as a success criterion.
 *
 * CAUSE IS STRUCTURAL, not an oversight: /today is a Route Handler that hand-writes its own
 * <head>, so it inherits NOTHING from the Next metadata system that /mindy-landing uses.
 *
 * ⚠️ WHAT WE DELIBERATELY DO NOT COPY: the apex JSON-LD graph is Organization +
 * SoftwareApplication + FAQPage. Those are SITE/PRODUCT-level entities that belong to the landing
 * page. Putting an FAQPage on a daily news page would be structured-data that lies about what the
 * page is. /today gets the schema it actually is: a WebPage that is part of the site.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'route.ts'), 'utf8');
// Slice the REAL <head>. Anchoring the end on indexOf('<style>') returned a position BEFORE the
// DOCTYPE — an example <style> appears inside a doc comment at the top of the file — so the slice
// was empty and every assertion "passed nothing". Anchor on both true boundaries instead.
const docStart = src.indexOf('<!DOCTYPE html>');
const head = src.slice(docStart, src.indexOf('<style>', docStart));

describe('/today carries the tags a shared link needs', () => {
  it('declares a canonical url', () => {
    expect(head).toContain('rel="canonical"');
    expect(head).toContain('https://getmindy.ai/today');
  });

  it('has the five Open Graph tags a link unfurl reads', () => {
    for (const t of ['og:title', 'og:description', 'og:image', 'og:type', 'og:site_name']) {
      expect(head, `missing ${t}`).toContain(t);
    }
  });

  it('reuses the REAL og image route rather than inventing a path', () => {
    // /opengraph-image is a live route (verified 200 image/png on prod). A made-up path would
    // render a broken card, which is worse than no card.
    expect(head).toContain('/opengraph-image');
    expect(head).toContain('og:image:width');
    expect(head).toContain('og:image:height');
  });

  it('has a large-image twitter card', () => {
    expect(head).toContain('twitter:card');
    expect(head).toContain('summary_large_image');
    expect(head).toContain('twitter:title');
  });

  it('describes itself as a WebPage — NOT the apex Organization/FAQPage graph', () => {
    expect(head).toContain('application/ld+json');
    // Assert on the JSON-LD BLOCK, not the whole head: the comment above it explains which apex
    // entities we deliberately omit, and naming them there made a whole-head grep match its own
    // prose. (Same false-positive that bit the ?horizon= dead-param test earlier the same day.)
    const ld = head.slice(head.indexOf('application/ld+json'), head.indexOf('</script>', head.indexOf('application/ld+json')));
    expect(ld).toContain('"@type":"WebPage"');
    // Copying these onto a daily news page would be structured data that lies.
    expect(ld).not.toContain('FAQPage');
    expect(ld).not.toContain('SoftwareApplication');
    // It must still tie back to the site/publisher the apex declares.
    expect(ld).toContain('isPartOf');
  });

  it('is indexable — no accidental noindex on the would-be homepage', () => {
    expect(head).not.toMatch(/noindex/i);
  });

  it('keeps the title and description it already had', () => {
    expect(head).toContain("Today's Intel");
    expect(head).toContain('name="description"');
  });
});
