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

function fnBody(s: string, name: string): string {
  const start = s.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  const open = s.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

// Brace-match an ASSIGNED function so these assertions survive the function growing.
function assignedFnBody(s: string, name: string): string {
  const start = s.indexOf(`${name}=function`);
  if (start < 0) throw new Error(`${name} not found`);
  const open = s.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

describe('the drawer opens the new workspace', () => {
  it('no longer points Generate proposal at the old /app panel', () => {
    expect(map).toContain('onclick="openProposalWorkspace(this)" data-act="draft a proposal"');
    // The old static destination is gone from THIS button (the forecast "Draft capture strategy"
    // still uses gateDraft + a data-u, and that path works now that /app reads ?notice).
    expect(map).not.toContain('data-act="draft a proposal" data-u="/app?panel=proposals');
  });

  it('opens /opportunity-map/proposal scoped to the pursuit', () => {
    const fn = assignedFnBody(map, 'window.openProposalWorkspace');
    expect(fn).toContain("'/opportunity-map/proposal'");
    expect(fn).toContain("'?pursuit='+encodeURIComponent(pid)");
    expect(fn).toContain('saveCurrentOpp(btn,function(ok,pid)');
  });

  it('gates on sign-in and RESUMES the click afterwards', () => {
    const fn = assignedFnBody(map, 'window.openProposalWorkspace');
    // Without the resume callback the login bounce silently eats the click.
    expect(fn).toContain("window.requireSignIn('draft a proposal',function(){ window.openProposalWorkspace(btn); })");
  });

  it('keeps the proposal_started funnel event continuous across the switch', () => {
    const fn = assignedFnBody(map, 'window.openProposalWorkspace');
    expect(fn).toContain("window.__track('link_click','proposal_started'");
  });

  it('does not re-POST when the pursuit id is already known', () => {
    const fn = assignedFnBody(map, 'window.openProposalWorkspace');
    expect(fn).toContain('if(btn.dataset.pursuitId){ go(btn.dataset.pursuitId); return; }');
  });

  it('still opens the workspace when no id could be resolved', () => {
    // Refusing to navigate would strand a user whose opportunity IS tracked over a lookup that
    // merely did not resolve. Unscoped is worse than scoped; a dead button is worse than both.
    const fn = assignedFnBody(map, 'window.openProposalWorkspace');
    expect(fn).toContain("go(ok?pid:'');");
  });
});

describe('the pursuit id survives an already-tracked opportunity', () => {
  it('returns the existing row alongside the 409', () => {
    expect(api).toContain("if (error.code === '23505')");
    expect(api).toContain(".eq('notice_id', body.notice_id)");
    expect(api).toContain("{ error: 'Opportunity already in pipeline', opportunity: existing }");
    // Best-effort: a failed lookup must still produce the same 409, not a 500.
    expect(api).toContain('catch { /* best-effort');
  });

  it('the client reads that row id and caches it on the button', () => {
    const save = assignedFnBody(map, 'window.saveCurrentOpp');
    expect(save).toContain('var _pid=(d&&d.opportunity&&d.opportunity.id)?String(d.opportunity.id):');
    expect(save).toContain('btn.dataset.pursuitId=_pid');
    expect(save).toContain('done(true,_pid)');
    // The early return (already saved) must hand back the cached id too, or the second click loses it.
    expect(save).toContain("done(btn.dataset.saved==='1',btn.dataset.pursuitId||'')");
  });
});

describe('the recompete drawer uses the same workspace', () => {
  it('"Draft capture strategy" opens the map-native workspace', () => {
    expect(map).toContain('onclick="openProposalWorkspace(this)" data-act="draft a capture strategy"');
    // The old /app link and its now-dead URL builder are gone.
    expect(map).not.toContain("var draftUrl='/app?panel=proposals&notice=");
    // No live /app?panel=proposals link survives anywhere in the map (comments aside).
    expect(map).not.toContain('href="/app?panel=proposals');
    expect(map).not.toContain('data-u="/app?panel=proposals');
  });

  it('routes through the PIPELINE save, not the saved-opportunities one', () => {
    // saveCurrentRecompete posts to /api/opportunities/save, which creates NO pursuit row — and the
    // workspace keys on ?pursuit=<id>. openProposalWorkspace uses saveCurrentOpp (/api/pipeline)
    // instead, so the draft has something to attach to. "Track this recompete" is untouched.
    expect(map).toContain("fetch('/api/opportunities/save'");        // still there for the Track button
    const opener = assignedFnBody(map, 'window.openProposalWorkspace');
    expect(opener).toContain('saveCurrentOpp(btn,function(ok,pid)');
  });
});

describe('the button label survives a click', () => {
  it('shows what the click is doing, then restores the original label', () => {
    // saveCurrentOpp relabels to "Saving…"/"✓ Tracked" — right for a Track button, wrong for one
    // that says "Generate proposal" or "Draft capture strategy", where tracking is a MEANS.
    const opener = assignedFnBody(map, 'window.openProposalWorkspace');
    expect(opener).toContain('var _label=getBtnLabel(btn);');
    expect(opener).toContain("setBtnLabel(btn,'Opening");  // escape depth deliberately not matched
    expect(opener).toContain('function restore(){ try{ setBtnLabel(btn,_label); }catch(e){} }');
    // Restored on EVERY exit through go(), including the already-known-id shortcut.
    expect(opener).toContain('function go(pid){\n      restore();');
  });

  it('getBtnLabel mirrors setBtnLabel for rich buttons', () => {
    const body = fnBody(map, 'getBtnLabel');
    // eslint-disable-next-line no-new-func
    const getBtnLabel = new Function(`${body}; return getBtnLabel;`)() as (b: unknown) => string;
    const rich = { textContent: 'allofit', querySelector: (s: string) => (s === '.fc-move-t' ? { textContent: 'Track it' } : null) };
    expect(getBtnLabel(rich)).toBe('Track it');
    expect(getBtnLabel({ textContent: 'Generate proposal', querySelector: () => null })).toBe('Generate proposal');
  });
});
