/**
 * /roadmap — the 2027 Federal Contracting Roadmap, presented by Mindy.
 *
 * A live, open page (no sign-up, no quiz): all 5 phases and 27 steps of the Action Plan, which the
 * visitor can check off. Its job is to FUNNEL into the free course (/course/roadmap), which teaches
 * how to do each step. Steps come from the Action Plan source of truth (src/lib/learn/action-plan.ts),
 * never retyped here.
 */
import type { Metadata } from 'next';
import { siteShareImages } from '@/lib/seo/share-image';
import RoadmapChecklist from './RoadmapChecklist';

const PAGE_URL = 'https://getmindy.ai/roadmap';
const TITLE = '2027 Federal Contracting Roadmap | Mindy';
const DESC = 'The free 2027 Federal Contracting Roadmap from Mindy: 27 steps across 5 phases, from setup to winning and managing federal contracts.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: PAGE_URL },
  openGraph: { title: TITLE, description: DESC, url: PAGE_URL, images: siteShareImages() },
};

export default function RoadmapPage() {
  return (
    <main>
      <RoadmapChecklist />
    </main>
  );
}
