/**
 * "Generate proposal" opens the MAP-NATIVE Proposal Workspace.
 *
 * The drawer button used to open /app?panel=proposals&notice=<id> — the old design. The new
 * workspace lives at /opportunity-map/proposal and keys on ?pursuit=<user_pipeline row id>, while
 * the drawer only knows a NOTICE id. Tracking is the prerequisite for drafting anyway, so the
 * button tracks and then opens with the id the save returns (the same track-then-open shape as
 * "Start capture").
 *
 * The awkward case is an opportunity ALREADY tracked: the insert 409s, and the 409 carried no row,
 * so the id was unavailable exactly when it was most likely to be needed. The API now returns the
 * existing row alongside the 409.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const map = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const api = readFileSync(join(__dirname, '../api/pipeline/route.ts'), 'utf8');

function slice(s: string, from: string, len = 1400): string {
  const i = s.indexOf(from);
  if (i < 0) throw new Error(`not found: ${from}`);
  return s.slice(i, i + len);
}

describe('the drawer opens the new workspace', () => {
  it('no longer points Generate proposal at the old /app panel', () => {
    expect(map).toContain('onclick="openProposalWorkspace(this)" data-act="draft a proposal"');
    // The old static destination is gone from THIS button (the forecast "Draft capture strategy"
    // still uses gateDraft + a data-u, and that path works now that /app reads ?notice).
    expect(map).not.toContain('data-act="draft a proposal" data-u="/app?panel=proposals');
  });

  it('opens /opportunity-map/proposal scoped to the pursuit', () => {
    const fn = slice(map, 'window.openProposalWorkspace=function');
    expect(fn).toContain("'/opportunity-map/proposal'");
    expect(fn).toContain("'?pursuit='+encodeURIComponent(pid)");
    expect(fn).toContain('saveCurrentOpp(btn,function(ok,pid)');
  });

  it('gates on sign-in and RESUMES the click afterwards', () => {
    const fn = slice(map, 'window.openProposalWorkspace=function');
    // Without the resume callback the login bounce silently eats the click.
    expect(fn).toContain("window.requireSignIn('draft a proposal',function(){ window.openProposalWorkspace(btn); })");
  });

  it('keeps the proposal_started funnel event continuous across the switch', () => {
    const fn = slice(map, 'window.openProposalWorkspace=function');
    expect(fn).toContain("window.__track('link_click','proposal_started'");
  });

  it('does not re-POST when the pursuit id is already known', () => {
    const fn = slice(map, 'window.openProposalWorkspace=function');
    expect(fn).toContain('if(btn.dataset.pursuitId){ go(btn.dataset.pursuitId); return; }');
  });

  it('still opens the workspace when no id could be resolved', () => {
    // Refusing to navigate would strand a user whose opportunity IS tracked over a lookup that
    // merely did not resolve. Unscoped is worse than scoped; a dead button is worse than both.
    const fn = slice(map, 'window.openProposalWorkspace=function');
    expect(fn).toContain("go(ok?pid:'');");
  });
});

describe('the pursuit id survives an already-tracked opportunity', () => {
  it('returns the existing row alongside the 409', () => {
    const dup = slice(api, "if (error.code === '23505')", 1200);
    expect(dup).toContain(".eq('notice_id', body.notice_id)");
    expect(dup).toContain("{ error: 'Opportunity already in pipeline', opportunity: existing }");
    // Best-effort: a failed lookup must still produce the same 409, not a 500.
    expect(dup).toContain('catch { /* best-effort');
  });

  it('the client reads that row id and caches it on the button', () => {
    const save = slice(map, 'window.saveCurrentOpp=function', 2000);
    expect(save).toContain('var _pid=(d&&d.opportunity&&d.opportunity.id)?String(d.opportunity.id):');
    expect(save).toContain('btn.dataset.pursuitId=_pid');
    expect(save).toContain('done(true,_pid)');
    // The early return (already saved) must hand back the cached id too, or the second click loses it.
    expect(save).toContain("done(btn.dataset.saved==='1',btn.dataset.pursuitId||'')");
  });
});
