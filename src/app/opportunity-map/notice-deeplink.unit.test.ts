/**
 * ?notice=<SAM notice id> — the Opportunity Map has always sent it; nothing ever read it.
 *
 * /app parsed reset/setup/signup/panel/email and nothing else, so "Generate proposal" and the
 * forecast draft link dropped the id and landed the user on an empty Proposals panel (Eric
 * 2026-08-13: "it takes me back to the /app page"). "Start capture" was fixed first by making it
 * track + open the pursuits tracker; this is the proper fix for the two proposal surfaces.
 *
 * The map knows a NOTICE, the panel keys on a PURSUIT ROW id, so the notice is resolved against
 * the pursuits ProposalsPanel already loads — no new endpoint, and it stays correct if the user
 * tracked the same notice from somewhere else.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appPage = readFileSync(join(__dirname, '../app/page.tsx'), 'utf8');
const panel = readFileSync(join(__dirname, '../../components/app/panels/ProposalsPanel.tsx'), 'utf8');
const map = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('/app consumes the notice param', () => {
  it('reads ?notice and forwards it via panelContext', () => {
    expect(appPage).toContain("searchParams.get('notice')");
    expect(appPage).toContain('notice_id: noticeParam');
    // Merged into any existing context rather than replacing it — panelContext is shared with the
    // Pipeline "Draft Proposal" hand-off, and clobbering it would break that path.
    expect(appPage).toContain('setPanelContext((prev) => ({ ...(prev || {}), notice_id: noticeParam }))');
  });
});

describe('ProposalsPanel resolves a notice to the user pursuit', () => {
  it('matches the notice against pursuits it already loaded', () => {
    expect(panel).toContain("typeof panelContext?.notice_id === 'string'");
    expect(panel).toContain('opportunities.find((opp) => opp.notice_id && String(opp.notice_id) === contextNoticeId)');
  });

  it('lets an explicit pursuit_id win over the notice', () => {
    // The Pipeline button names the exact row; the notice is only a fallback for links that
    // cannot know the row id.
    expect(panel).toContain('const resolvedContextPursuitId = contextPursuitId || noticePursuitId;');
    expect(panel).toContain('livePursuitIds.has(resolvedContextPursuitId)');
    expect(panel).toContain('contextPursuitIsLive ? resolvedContextPursuitId : null');
  });

  it('says so when the notice was never tracked, instead of showing an empty workbench', () => {
    // Distinct from staleContextPursuit: nothing is wrong, the user just has not saved it.
    expect(panel).toContain('const untrackedContextNotice = Boolean(');
    expect(panel).toContain('pipelineLoaded && contextNoticeId && !noticePursuitId && !contextPursuitId && !localPursuitId');
    expect(panel).toContain('{untrackedContextNotice && (');
    // The stale-pursuit case must stay keyed on pursuit_id only — an untracked notice is not stale.
    expect(panel).toContain('const staleContextPursuit = Boolean(pipelineLoaded && contextPursuitId && !contextPursuitIsLive && !localPursuitId);');
  });
});

describe('the map still sends the id it now knows will be read', () => {
  it('keeps notice= on both proposal surfaces', () => {
    expect(map).toContain("data-u=\"/app?panel=proposals&notice='+encodeURIComponent(o.id)+'\"");
    expect(map).toContain("var draftUrl='/app?panel=proposals&notice='+encodeURIComponent(o.sol||o.nid||'');");
  });
});
