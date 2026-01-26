import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'GovCon Content Generator | GovCon Giants',
  description: 'AI-powered content generator for government contractors. Create capability statements, proposals, and marketing content.',
};

export default function ContentGeneratorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
