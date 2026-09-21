import { Metadata } from 'next';

export const metadata: Metadata = {
  title: "Mindy's Living Intelligence Layer | How Mindy Works",
  description:
    'Mindy is not just an AI tool — it is a Living Intelligence Layer. Your business profile fused with a curated GovCon knowledge corpus, producing federal-grade drafts, briefings, and insights no generic LLM can match.',
  openGraph: {
    title: "Mindy's Living Intelligence Layer",
    description:
      'Your business profile + a curated GovCon knowledge corpus. Federal-grade drafts and briefings grounded in your real data and 8 years of teaching.',
    siteName: 'Mindy',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: "Mindy's Living Intelligence Layer",
    description: 'How Mindy combines your business profile with a curated GovCon knowledge corpus.',
  },
};

export default function MindyIntelligenceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
