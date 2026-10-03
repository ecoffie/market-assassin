import type { Metadata } from 'next';
import PublicShell from '@/components/public-site/PublicShell';

export const metadata: Metadata = {
  title: 'AI Prompts for GovCon | Mindy',
  description: '75+ ready-to-use AI prompts to accelerate your federal contracting business.',
};

export default function AIPromptsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicShell>{children}</PublicShell>;
}
