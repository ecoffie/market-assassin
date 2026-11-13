/**
 * Admin: review Mindy Ambassador applications.
 *
 *   GET  /api/admin/ambassadors?password=…[&status=pending|approved|rejected|removed][&format=json]
 *        → the review page (HTML) with Approve / Reject / Remove buttons, or JSON.
 *   POST /api/admin/ambassadors?password=…   { action: 'approve'|'reject'|'remove', email, note? }
 *
 * Approve: grants free Pro (the same member-grants path as a staff grant), makes metered MCP calls
 * cost 0 credits (src/lib/mcp/metered.ts), creates their referral code and emails them the welcome.
 * Remove: revokes the Pro grant and the zero-cost calls.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { ambassadorReferralLink, getAmbassador, listAmbassadors, setDecision, type AmbassadorRow, type AmbassadorStatus } from '@/lib/ambassadors/store';
import { applyMemberGrant } from '@/lib/admin/member-grants';
import { getOrCreateReferralCode } from '@/lib/mcp/referrals';
import { sendApprovedEmail } from '@/lib/ambassadors/emails';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUSES: AmbassadorStatus[] = ['pending', 'approved', 'rejected', 'removed'];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (!verifyAdminPassword(sp.get('password'))) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  const status = STATUSES.includes(sp.get('status') as AmbassadorStatus) ? (sp.get('status') as AmbassadorStatus) : undefined;
  let rows: AmbassadorRow[];
  try {
    rows = await listAmbassadors(status);
  } catch (err) {
    return NextResponse.json({ success: false, message: (err as Error).message }, { status: 500 });
  }
  if (sp.get('format') === 'json') return NextResponse.json({ success: true, message: `${rows.length} applications`, data: rows });
  return new NextResponse(renderReview(rows, status), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  if (!verifyAdminPassword(req.nextUrl.searchParams.get('password'))) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { action?: string; email?: string; note?: string };
  const email = (body.email || '').trim().toLowerCase();
  const note = (body.note || '').trim().slice(0, 500) || null;
  const action = body.action;
  if (!email || !['approve', 'reject', 'remove'].includes(action || '')) {
    return NextResponse.json({ success: false, message: 'Send { action: approve|reject|remove, email }' }, { status: 400 });
  }
  const actor = 'admin-password';
  try {
    const app = await getAmbassador(email);
    if (!app) return NextResponse.json({ success: false, message: `No application for ${email}` }, { status: 404 });

    if (action === 'reject') {
      const row = await setDecision(email, 'rejected', actor, note);
      return NextResponse.json({ success: true, message: `Rejected ${email}`, data: row });
    }

    if (action === 'remove') {
      const grant = await applyMemberGrant({ targetEmail: email, actorEmail: actor, tier: 'pro', action: 'revoke', sendWelcome: false, note: 'Ambassador removed' });
      const row = await setDecision(email, 'removed', actor, note);
      return NextResponse.json({ success: true, message: `Removed ${email}`, data: row, errors: grant.success ? undefined : [grant.error || grant.message] });
    }

    // approve
    const grant = await applyMemberGrant({ targetEmail: email, actorEmail: actor, tier: 'pro', action: 'grant', sendWelcome: false, grantSource: 'comp', note: 'Mindy Ambassador' });
    if (!grant.success) {
      return NextResponse.json({ success: false, message: `Pro grant failed, nothing changed: ${grant.error || grant.message}` }, { status: 502 });
    }
    const code = await getOrCreateReferralCode(email);
    const row = await setDecision(email, 'approved', actor, note, code);
    const emailed = await sendApprovedEmail(email, app.name, ambassadorReferralLink(code));
    return NextResponse.json({
      success: true,
      message: `Approved ${email}${emailed ? '' : ' (welcome email NOT sent — send it by hand)'}`,
      data: { ...row, referralLink: ambassadorReferralLink(code), welcomeEmailSent: emailed },
      errors: grant.warning ? [grant.warning] : undefined,
    });
  } catch (err) {
    return NextResponse.json({ success: false, message: (err as Error).message }, { status: 500 });
  }
}

const esc = (s: string | null | undefined) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderReview(rows: AmbassadorRow[], status?: AmbassadorStatus): string {
  const tab = (s?: AmbassadorStatus) => `<a class="tab${s === status ? ' on' : ''}" href="?status=${s ?? ''}" data-keep>${s ? s[0].toUpperCase() + s.slice(1) : 'All'}</a>`;
  const link = (u: string | null | undefined, label: string) => (u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${label}</a>` : '');
  const para = (label: string, v: string | null | undefined) => (v ? `<p><b>${label}.</b> ${esc(v)}</p>` : '');
  const card = (r: AmbassadorRow) => `<article class="card">
  <header><div><b>${esc(r.name)}</b> <span class="st st-${r.status}">${r.status}</span><div class="muted">${esc(r.email)}${r.company ? ` · ${esc(r.company)}` : ''}${r.uei ? ` · UEI ${esc(r.uei)}` : ''}${r.role ? ` · ${esc(r.role)}` : ''}</div></div>
  <div class="muted">${new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div></header>
  <div class="links">${link(r.post_url, 'Where they post')}${r.uei ? `<a href="https://sam.gov/search/?keywords=${encodeURIComponent(r.uei)}" target="_blank" rel="noopener">SAM record</a>` : ''}${link(r.linkedin_url, 'LinkedIn')}${link(r.website_url, 'Website')}</div>
  ${para('Last event attended', r.last_event)}${para('Pursuit in motion', r.pursuit)}${para('Wants to find out', r.want_to_find)}
  ${r.attested_at ? '<p class="muted">Attested: meets all six requirements and will disclose on every post.</p>' : ''}
  ${para('Who they reach', r.audience)}${para('Why', r.why)}${para('How they would share Mindy', r.promote_plan)}
  ${r.referral_code ? `<p class="muted">Referral link: getmindy.ai/pricing?ref=${esc(r.referral_code)}</p>` : ''}
  ${r.decision_note ? `<p class="muted">Note: ${esc(r.decision_note)}</p>` : ''}
  <div class="acts" data-email="${esc(r.email)}">
    ${r.status !== 'approved' ? '<button data-a="approve" class="pri">Approve</button>' : ''}
    ${r.status === 'pending' ? '<button data-a="reject">Reject</button>' : ''}
    ${r.status === 'approved' ? '<button data-a="remove">Remove</button>' : ''}
    <span class="msg"></span>
  </div></article>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ambassadors</title>
<style>body{margin:0;background:#faf9f5;color:#1f1e1d;font:15px/1.5 Inter,system-ui,sans-serif}.wrap{max-width:900px;margin:0 auto;padding:32px 16px;display:grid;gap:16px}
h1{font:400 32px Georgia,serif;margin:0}.tabs{display:flex;gap:6px;flex-wrap:wrap}.tab{padding:6px 12px;border-radius:999px;border:1px solid #e8e6dc;color:#1f1e1d;text-decoration:none;background:#fff}.tab.on{background:#1b3a6b;color:#fff;border-color:#1b3a6b}
.card{background:#fff;border:1px solid #e8e6dc;border-radius:12px;padding:18px;display:grid;gap:8px}.card header{display:flex;justify-content:space-between;gap:12px}.card p{margin:0}
.muted{color:#73716b;font-size:13px}.links{display:flex;gap:12px;font-size:14px}.links a{color:#1b3a6b}.st{font-size:12px;padding:2px 8px;border-radius:999px;background:#f0eee6;margin-left:6px}
.st-approved{background:#e6f4ea;color:#2f7d4f}.st-rejected,.st-removed{background:#fdecea;color:#b42318}.acts{display:flex;gap:8px;align-items:center;margin-top:4px}
button{font:inherit;padding:8px 16px;border-radius:8px;border:1px solid #d6d3c8;background:#fff;cursor:pointer}button.pri{background:#1b3a6b;color:#fff;border-color:#1b3a6b}.msg{font-size:13px;color:#73716b}</style></head>
<body><div class="wrap"><h1>Mindy Ambassadors</h1><p class="muted">${rows.length} application${rows.length === 1 ? '' : 's'}${status ? ` · ${status}` : ''}. Approving grants free Pro (MCP calls cost 0 credits), creates a referral link and emails the welcome. Check the requirements against their post link and SAM record before approving.</p>
<nav class="tabs">${tab()}${STATUSES.map(tab).join('')}</nav>
${rows.length ? rows.map(card).join('') : '<p class="muted">No applications here yet.</p>'}
</div><script>
var pw=new URLSearchParams(location.search).get('password')||'';
document.querySelectorAll('a[data-keep]').forEach(function(a){var u=new URL(a.href);u.searchParams.set('password',pw);a.href=u.toString();});
document.querySelectorAll('.acts button').forEach(function(b){b.addEventListener('click',function(){
  var box=b.parentNode,email=box.getAttribute('data-email'),action=b.getAttribute('data-a'),msg=box.querySelector('.msg');
  if(action!=='approve'&&!confirm(action[0].toUpperCase()+action.slice(1)+' '+email+'?'))return;
  var note=action==='approve'?'':(prompt('Optional note (private):')||'');
  box.querySelectorAll('button').forEach(function(x){x.disabled=true;});msg.textContent='Working…';
  fetch('/api/admin/ambassadors?password='+encodeURIComponent(pw),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:action,email:email,note:note})})
    .then(function(r){return r.json();}).then(function(j){msg.textContent=j.message||'';if(j.success)setTimeout(function(){location.reload();},900);else box.querySelectorAll('button').forEach(function(x){x.disabled=false;});})
    .catch(function(e){msg.textContent='Failed: '+e.message;box.querySelectorAll('button').forEach(function(x){x.disabled=false;});});
});});
</script></body></html>`;
}
