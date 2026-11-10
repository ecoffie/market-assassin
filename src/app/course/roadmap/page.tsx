import type { Metadata } from 'next';
import { PRO_MONTHLY_CREDITS } from '@/lib/mcp/packages';
import RoadmapFlow from './RoadmapFlow';

export const metadata: Metadata = {
  title: 'Your Personalized GovCon Roadmap — Free | Mindy',
  description: 'Answer six quick questions to find your stage in federal contracting and get the exact steps to take next.',
  alternates: { canonical: 'https://getmindy.ai/course/roadmap' },
};

export default function RoadmapPage() {
  return (
    <main>
      <RoadmapFlow proCredits={PRO_MONTHLY_CREDITS} />
    </main>
  );
}
