import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Content Reaper | GovCon Giants',
  description: 'AI-powered content creation for government contractors. Create LinkedIn posts that resonate with government buyers.',
};

export default function ContentGeneratorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
