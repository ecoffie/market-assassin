import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { TRIAL_CTA_LABEL } from './trial-cta';
import { BlogPostLayout } from '@/components/blog/BlogPostLayout';
import { BLOG_POSTS } from '@/data/blog-posts';

// /pricing has no free plan: the only path is a card-required 14-day trial.
// Shared CTAs that link there must not say "Start for free".
const root = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('trial CTA label', () => {
  it('uses the homepage trial wording', () => {
    expect(TRIAL_CTA_LABEL).toBe('Start 14-day free trial');
  });

  it('blog post footer CTA renders the trial label and links to /pricing', () => {
    const html = renderToStaticMarkup(
      <BlogPostLayout meta={BLOG_POSTS[0]} related={[]}>
        <p>body</p>
      </BlogPostLayout>,
    );
    expect(html).not.toContain('Start for free');
    expect(html).toMatch(/<a [^>]*href="\/pricing"[^>]*>Start 14-day free trial<\/a>/);
  });

  it.each([
    ['src/components/MeetMindyStrip.tsx', 2],
    ['src/components/blog/BlogPostLayout.tsx', 1],
    ['src/app/app/page.tsx', 1],
  ])('%s wires TRIAL_CTA_LABEL into its /pricing CTA (%i)', (file, uses) => {
    const src = read(file);
    expect(src).not.toMatch(/>\s*Start for free/);
    expect(src).toContain("import { TRIAL_CTA_LABEL } from '@/lib/public-site/trial-cta';");
    expect(src.match(/\{TRIAL_CTA_LABEL\}/g)?.length).toBe(uses);
  });
});
