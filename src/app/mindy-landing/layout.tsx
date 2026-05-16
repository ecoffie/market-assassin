import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Mindy - AI-Powered Federal Market Intelligence',
  description:
    'Your 24/7 federal market intelligence analyst. Mindy scans 24,000+ opportunities daily, tracks competitors, and delivers personalized briefings before your first coffee.',
  openGraph: {
    title: 'Mindy - AI-Powered Federal Market Intelligence',
    description:
      'Your 24/7 federal market intelligence analyst. Mindy scans 24,000+ opportunities daily and delivers personalized briefings.',
    siteName: 'Mindy',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mindy - AI-Powered Federal Market Intelligence',
    description:
      'Your 24/7 federal market intelligence analyst. Scans 24,000+ opportunities daily.',
  },
};

export default function MindyLandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
