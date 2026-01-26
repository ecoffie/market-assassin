import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI Prompts for GovCon | GovCon Giants',
  description: '75+ ready-to-use AI prompts to accelerate your federal contracting business.',
};

export default function AIPromptsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
