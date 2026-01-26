import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About | GovCon Giants',
  description: 'Learn about GovCon Giants and our mission to help small businesses win federal contracts.',
};

export default function AboutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
