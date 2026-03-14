import TestProtocolClient from './TestProtocolClient';

export const metadata = {
  title: 'Test Protocol | GovCon Giants',
  robots: 'noindex, nofollow',
};

export default function TestProtocolPage() {
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA || null;

  return <TestProtocolClient commitSha={commitSha} />;
}
