/**
 * getmindy.ai/mcp/gallery — "Mindy in your AI": a gallery of the finished results Mindy returns
 * inside Claude, ChatGPT or any MCP agent. The site's "Mindy in your AI" link points here.
 *
 * Results are public. Prompts are signed-in only (see Gallery.tsx and
 * /api/mcp/gallery/prompts). Credits are not shown.
 */
import type { Metadata } from 'next';
import PublicShell from '@/components/public-site/PublicShell';
import { GALLERY_ITEMS } from '@/lib/mcp/gallery';
import Gallery from './Gallery';

export const metadata: Metadata = {
  title: 'Mindy in your AI — finished federal contracting work from one question',
  description:
    'See what Mindy hands back inside Claude, ChatGPT or any AI agent: open bids, incumbents, buyers, labor rates, bid decisions, compliance matrices and proposal drafts.',
  alternates: { canonical: '/mcp/gallery' },
};

export default function McpGalleryPage() {
  return (
    <PublicShell>
      <Gallery items={GALLERY_ITEMS} />
    </PublicShell>
  );
}
