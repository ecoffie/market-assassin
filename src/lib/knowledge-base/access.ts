/**
 * Who may browse Mindy's source corpus (mindy_rag_documents) through the Knowledge Base panel and the single-document
 * route: Mindy staff only (Eric, 2026-11-27: "hide knowledge base"). The corpus is internal material, including real
 * proposal documents loaded by ingest scripts; it is not customer-facing. Mindy's own retrieval is unaffected.
 *
 * Uses the existing staff-role check (src/lib/access/staff-role.ts, dependency-free, so the UI can hide entry points
 * too). On the server it is called only with an email the request proved.
 */
import { getStaffRole } from '@/lib/access/staff-role';

export function canBrowseKnowledgeBase(email: string | null | undefined): boolean {
  return !!email && getStaffRole(email) !== 'none';
}
