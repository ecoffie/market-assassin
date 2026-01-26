import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SBLO Contact Directory | GovCon Giants',
  description: '225 Small Business Liaison Officers across 76+ federal agencies with direct contact info.',
};

export default function SBLODirectoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
