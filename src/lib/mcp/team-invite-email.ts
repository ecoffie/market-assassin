/**
 * The pooled-team invite email (tasks/PRD-pooled-team-credits.md). Transactional:
 * sent only because an owner invited this address. Kept out of the route file because
 * Next.js route modules may only export route handlers.
 */
import { renderMindyEmailLogo } from '@/lib/mindy/email-branding';
import { INVITE_TTL_DAYS } from './team-pools';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function renderTeamInviteEmail(p: { orgName: string; inviterEmail: string; acceptUrl: string }): string {
  const org = escapeHtml(p.orgName);
  const inviter = escapeHtml(p.inviterEmail);
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0"><tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden">
    <tr><td style="background:linear-gradient(90deg,#1e3a8a,#7c3aed);padding:24px;text-align:center">${renderMindyEmailLogo(48)}</td></tr>
    <tr><td style="padding:28px">
      <h1 style="font-size:20px;margin:0 0 12px">You've been invited to ${org} on Mindy</h1>
      <p style="font-size:15px;line-height:1.5;margin:0 0 16px">${inviter} added you as a named user. Your Mindy usage will draw from the team's shared credits, not your own.</p>
      <p style="margin:0 0 20px"><a href="${p.acceptUrl}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">Accept invite</a></p>
      <p style="font-size:13px;color:#6b7280;margin:0">Sign in with this email address to accept. The link expires in ${INVITE_TTL_DAYS} days. If you weren't expecting this, you can ignore it.</p>
    </td></tr>
    <tr><td style="padding:16px 28px;font-size:12px;color:#9ca3af;border-top:1px solid #eee">GovCon Giants AI · support@getmindy.ai</td></tr>
  </table></td></tr></table></body></html>`;
}

