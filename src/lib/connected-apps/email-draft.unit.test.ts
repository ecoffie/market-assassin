/**
 * Connected apps Slice B: Mindy saves an email DRAFT in the customer's own Gmail or Outlook and never sends.
 * Synthetic addresses only (example.gov / example.com); no customer data.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mailDraftClient, mimeMessage, checkDraftInput, recipientIsCited, makeEmailDraftTool, splitSignature, DraftError,
  EMAIL_DRAFT_TOOL_DEF, DRAFT_TIMEOUT_MS, type EmailDraftToolDeps, type VerifiedSource,
} from './email-draft';
import type { ConnectionView } from './store';
import { OUTREACH_RULES } from '@/lib/ask-mindy/outreach-rules';
import type { ChatActingScope } from '@/lib/chat/chat-acting-scope';

const GMAIL_COMPOSE = 'https://www.googleapis.com/auth/gmail.compose';
const BODY = [
  'Your office bought custodial services at the Tampa clinic each of the last two years, and the current order ends in August.',
  'We clean three outpatient clinics in Hillsborough County with no missed inspections.',
  'When do you expect the next requirement? Can we be added to your quote list?',
  '--',
  'Pat Example, Acme Clean LLC',
  'UEI ABCDEFGH1234 | CAGE 1ABC2 | SDVOSB | NAICS 561720',
].join('\n');
const ARGS = { to: 'co.jones@example.gov', subject: 'Custodial services at the Tampa clinic', body: BODY };

describe('the mail client can only create drafts', () => {
  it('has exactly one method, createDraft, and no send method', () => {
    expect(Object.keys(mailDraftClient)).toEqual(['createDraft']);
    expect(Object.isFrozen(mailDraftClient)).toBe(true);
    expect((mailDraftClient as Record<string, unknown>).send).toBeUndefined();
  });

  it('the module calls no send endpoint (Gmail drafts.send / messages.send, Graph sendMail or /send)', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/connected-apps/email-draft.ts'), 'utf8');
    expect(src).not.toMatch(/drafts\/send|messages\/send|sendMail|\/send\b|gmail\.send|Mail\.Send/);
  });

  it('Gmail: users.drafts.create with a raw MIME message; returns the draft id and a web link for that account', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: 'r-123', message: { id: '18c0ffee' } }), { status: 200 }));
    const d = await mailDraftClient.createDraft('google', 'tok', { to: 'co.jones@example.gov', subject: 'Héllo', body: 'Line one' }, 'pat@example.com', f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/drafts');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const raw = JSON.parse(String(init.body)).message.raw as string;
    const mime = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    expect(mime).toContain('To: co.jones@example.gov');
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from('Héllo').toString('base64')}?=`);
    expect(d).toEqual({ id: 'r-123', webLink: 'https://mail.google.com/mail/?authuser=pat%40example.com#drafts?compose=18c0ffee' });
  });

  it('Outlook: Graph POST /me/messages (saved in Drafts, not sent); returns the webLink', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: 'AAMk', webLink: 'https://outlook.office365.com/owa/?ItemID=AAMk' }), { status: 201 }));
    const d = await mailDraftClient.createDraft('microsoft', 'tok', { to: null, subject: 'S', body: 'B' }, 'pat@example.com', f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/messages');
    expect(JSON.parse(String(init.body))).toEqual({ subject: 'S', body: { contentType: 'Text', content: 'B' }, toRecipients: [] });
    expect(d.webLink).toBe('https://outlook.office365.com/owa/?ItemID=AAMk');
  });

  it('both provider calls carry a 15 s abort signal', async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const f = vi.fn(async (_u: string, init?: RequestInit) => { seen.push(init?.signal ?? undefined); return new Response(JSON.stringify({ id: 'x', message: { id: 'm' }, webLink: 'https://outlook.office.com/x' }), { status: 200 }); });
    await mailDraftClient.createDraft('google', 't', { to: null, subject: 's', body: 'b' }, 'a@example.com', f as unknown as typeof fetch);
    await mailDraftClient.createDraft('microsoft', 't', { to: null, subject: 's', body: 'b' }, 'a@example.com', f as unknown as typeof fetch);
    expect(seen).toHaveLength(2);
    for (const sig of seen) expect(sig).toBeInstanceOf(AbortSignal);
    expect(DRAFT_TIMEOUT_MS).toBe(15_000);
  });

  it('maps provider refusals to typed errors, never a success', async () => {
    for (const [status, code] of [[401, 'reauth_needed'], [403, 'permission_needed'], [429, 'rate_limited'], [500, 'provider_error']] as const) {
      const f = vi.fn(async () => new Response('{}', { status }));
      await expect(mailDraftClient.createDraft('google', 't', { to: null, subject: 's', body: 'b' }, 'a@example.com', f as unknown as typeof fetch)).rejects.toMatchObject({ code });
    }
  });

  it('a subject cannot inject headers (CR/LF refused before MIME is built)', () => {
    expect(checkDraftInput({ ...ARGS, subject: 'Hi\r\nBcc: x@example.com' })).toMatchObject({ ok: false, code: 'invalid_subject' });
    expect(mimeMessage({ to: null, subject: 'x', body: 'y' })).not.toMatch(/^To:/m);
  });
});

describe('content rules (outreach)', () => {
  it('accepts a buyer-first draft with the certification only under the signature', () => {
    const r = checkDraftInput(ARGS);
    expect(r.ok).toBe(true);
    expect(splitSignature(BODY).signature).toContain('SDVOSB');
  });

  it('refuses em or en dashes', () => {
    expect(checkDraftInput({ ...ARGS, body: BODY.replace('two years,', 'two years —') })).toMatchObject({ ok: false, code: 'em_dash' });
    expect(checkDraftInput({ ...ARGS, subject: 'Tampa – custodial' })).toMatchObject({ ok: false, code: 'em_dash' });
  });

  it('refuses a message of 150 words or more (the signature block does not count)', () => {
    const long = `${Array.from({ length: 151 }, () => 'word').join(' ')}\n--\nPat`;
    expect(checkDraftInput({ ...ARGS, body: long })).toMatchObject({ ok: false, code: 'too_long' });
    const sigHeavy = `Short note about your buy.\n--\n${Array.from({ length: 200 }, () => 'sig').join(' ')}`;
    expect(checkDraftInput({ ...ARGS, body: sigHeavy }).ok).toBe(true);
  });

  it('refuses a certification in the message or subject ("We are an SDVOSB firm")', () => {
    expect(checkDraftInput({ ...ARGS, body: `We are an SDVOSB firm.\n${BODY}` })).toMatchObject({ ok: false, code: 'certification_in_message' });
    expect(checkDraftInput({ ...ARGS, subject: '8(a) firm for your custodial work' })).toMatchObject({ ok: false, code: 'certification_in_message' });
  });

  it('refuses more than one recipient or a malformed one; empty is fine', () => {
    expect(checkDraftInput({ ...ARGS, to: 'a@example.gov, b@example.gov' })).toMatchObject({ ok: false, code: 'invalid_recipient' });
    expect(checkDraftInput({ ...ARGS, to: 'not-an-email' })).toMatchObject({ ok: false, code: 'invalid_recipient' });
    expect(checkDraftInput({ ...ARGS, to: '' })).toMatchObject({ ok: true });
  });

  it('every refusal tells the model to rewrite and call again', () => {
    const r = checkDraftInput({ ...ARGS, body: 'x — y' });
    expect(!r.ok && r.message).toMatch(/Rewrite the draft and call create_email_draft again/);
  });

  it('the tool definition carries the outreach rules and the published-recipient rule', () => {
    const d = EMAIL_DRAFT_TOOL_DEF.function.description;
    expect(d).toMatch(/NEVER sends/);
    expect(d).toMatch(/first sentence is about the buyer/);
    expect(d).toMatch(/under 150 words/);
    expect(d).toMatch(/no em dashes/);
    expect(d).toMatch(/certifications only in the credentials block/);
    expect(d).toMatch(/Never infer one from a name/);
    expect(EMAIL_DRAFT_TOOL_DEF.function.parameters.required).toEqual(['subject', 'body']);
    // The shared outreach rules (#2515) are in the tool description verbatim, so the draft cannot drift from them.
    expect(d).toContain(OUTREACH_RULES);
    expect(d).toMatch(/"Before you send" list and the closing line belong in your chat answer, never in the email/);
  });
});

describe('recipient provenance', () => {
  const notice: VerifiedSource = { text: JSON.stringify([{ fullName: 'C. Jones', email: 'CO.Jones@example.gov' }]) };
  it('cited when the address appears whole in a cited record (case-insensitive)', () => {
    expect(recipientIsCited('co.jones@example.gov', [notice])).toBe(true);
  });
  it('not cited when it only appears inside a longer address, or not at all', () => {
    expect(recipientIsCited('jones@example.gov', [notice])).toBe(false);
    expect(recipientIsCited('co.jones@example.gov.evil.com', [notice])).toBe(false);
    expect(recipientIsCited('someone@example.gov', [notice])).toBe(false);
  });
  it('web text counts only for official .gov / .mil addresses', () => {
    const web: VerifiedSource = { text: 'Contact sales@vendor.example.com or osbp@example.gov', officialOnly: true };
    expect(recipientIsCited('osbp@example.gov', [web])).toBe(true);
    expect(recipientIsCited('sales@vendor.example.com', [web])).toBe(false);
  });
});

describe('create_email_draft tool', () => {
  const own: ChatActingScope = { kind: 'own', email: 'pat@example.com' } as ChatActingScope;
  const conn = (over: Partial<ConnectionView> = {}): ConnectionView => ({
    id: 'c-1', provider: 'google', connected_email: 'pat@acmeclean.example.com', display_name: null,
    granted_scopes: ['openid', 'https://www.googleapis.com/auth/drive.file', GMAIL_COMPOSE], status: 'connected', created_at: '', ...over,
  });
  function setup(o: { conns?: ConnectionView[]; scope?: ChatActingScope; sources?: VerifiedSource[]; create?: EmailDraftToolDeps['client']['createDraft']; token?: EmailDraftToolDeps['token'] } = {}) {
    const createDraft = vi.fn(o.create ?? (async () => ({ id: 'd-1', webLink: 'https://mail.google.com/mail/?authuser=x#drafts?compose=abc' })));
    const log = vi.fn();
    const resolveScope = vi.fn(async () => o.scope ?? own);
    const list = vi.fn(async () => o.conns ?? [conn()]);
    const token = vi.fn(o.token ?? (async () => ({ ok: true as const, token: 'live', provider: 'google' as const, connection: conn() })));
    const tool = makeEmailDraftTool({
      resolveScope, callerEmail: 'Pat@Example.com',
      verifiedSources: () => o.sources ?? [{ text: '{"points_of_contact":[{"email":"co.jones@example.gov"}]}' }],
      deps: { list: list as never, token: token as never, client: { createDraft } as never, log },
    });
    return { tool, createDraft, log, resolveScope, list, token };
  }

  it('saves a draft (not sent) with the cited recipient and returns the link to review and send', async () => {
    const { tool, createDraft } = setup();
    const r = await tool.execute(ARGS);
    expect(r).toMatchObject({ ok: true, action: 'draft_saved_not_sent', recipient: 'co.jones@example.gov', recipient_status: 'cited', draft_id: 'd-1' });
    expect(String(r.message)).toMatch(/NOT sent/);
    expect(createDraft).toHaveBeenCalledWith('google', 'live', { to: 'co.jones@example.gov', subject: ARGS.subject, body: BODY }, 'pat@acmeclean.example.com');
  });

  it('an address the records do not cite is left blank, never guessed', async () => {
    const { tool, createDraft } = setup({ sources: [] });
    const r = await tool.execute(ARGS);
    expect(r).toMatchObject({ ok: true, recipient: null, recipient_status: 'left_blank_not_cited' });
    expect(createDraft.mock.calls[0][2]).toMatchObject({ to: null });
  });

  it('re-resolves the acting scope on every call, and refuses when the workspace is unconfirmed', async () => {
    const a = setup();
    await a.tool.execute(ARGS);
    await a.tool.execute({ ...ARGS, subject: 'Another' });
    expect(a.resolveScope).toHaveBeenCalledTimes(2);
    const b = setup({ scope: { kind: 'unavailable' } as ChatActingScope });
    expect(await b.tool.execute(ARGS)).toMatchObject({ ok: false, error_category: 'workspace_unavailable' });
    expect(b.createDraft).not.toHaveBeenCalled();
  });

  it('the connection lookup is bound to the acting scope and the calling user', async () => {
    const { tool, list } = setup();
    await tool.execute(ARGS);
    expect(list).toHaveBeenCalledWith('own:pat@example.com', 'Pat@Example.com');
  });

  it('no connected account: offers to connect and asks for copy-paste text, never fails silently', async () => {
    const { tool, createDraft } = setup({ conns: [] });
    const r = await tool.execute(ARGS);
    expect(r).toMatchObject({ ok: false, error_category: 'not_connected' });
    expect(String(r.message)).toMatch(/copy-paste text/);
    expect(String(r.message)).toMatch(/Connect Google Drive and Connect OneDrive/);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('a file-only connection is asked to allow drafts; no provider call', async () => {
    const { tool, createDraft, token } = setup({ conns: [conn({ granted_scopes: ['https://www.googleapis.com/auth/drive.file'] })] });
    const r = await tool.execute(ARGS);
    expect(r).toMatchObject({ ok: false, error_category: 'permission_needed' });
    expect(String(r.message)).toMatch(/Allow email drafts/);
    expect(token).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('two accounts: asks which; an id that is not the caller\'s is refused', async () => {
    const two = [conn(), conn({ id: 'c-2', provider: 'microsoft', connected_email: 'pat@outlook.example.com', granted_scopes: ['Mail.ReadWrite'] })];
    const a = setup({ conns: two });
    expect(await a.tool.execute(ARGS)).toMatchObject({ ok: false, error_category: 'choose_account' });
    expect(await a.tool.execute({ ...ARGS, connected_account_id: 'someone-elses' })).toMatchObject({ ok: false, error_category: 'unknown_account' });
    const ok = await a.tool.execute({ ...ARGS, connected_account_id: 'c-2' });
    expect(ok).toMatchObject({ ok: true, provider: 'microsoft' });
  });

  it('a dead grant asks to reconnect', async () => {
    const { tool, createDraft } = setup({ token: (async () => ({ ok: false as const, reason: 'reauth_needed' as const })) as never });
    expect(await tool.execute(ARGS)).toMatchObject({ ok: false, error_category: 'reauth_needed' });
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('a provider failure is never reported as a saved draft', async () => {
    const { tool } = setup({ create: async () => { throw new DraftError('provider_error'); } });
    const r = await tool.execute(ARGS);
    expect(r).toMatchObject({ ok: false, error_category: 'provider_error' });
    expect(String(r.message)).toMatch(/check their Drafts folder before trying again/);
  });

  it('a timeout is never a saved draft: copy-paste fallback and "check Drafts before trying again"', async () => {
    const { tool } = setup({ create: async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); } });
    const r = await tool.execute(ARGS);
    expect(r).toMatchObject({ ok: false, error_category: 'timeout' });
    expect(String(r.message)).toMatch(/did not answer in time/);
    expect(String(r.message)).toMatch(/check their Drafts folder before trying again/);
    expect(String(r.message)).toMatch(/copy-paste text/);
  });

  it('the same draft retried in the turn is saved once', async () => {
    const { tool, createDraft } = setup();
    await tool.execute(ARGS);
    const again = await tool.execute(ARGS);
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(again).toMatchObject({ ok: true, draft_id: 'd-1' });
  });

  it('every draft is logged with who, account and recipient domain, never the subject or body', async () => {
    const { tool, log } = setup();
    await tool.execute(ARGS);
    const e = log.mock.calls[0][0];
    expect(e).toMatchObject({ event: 'connected_apps.email_draft', who: 'pat@example.com', account: 'pat@acmeclean.example.com', recipient_domain: 'example.gov', outcome: 'created' });
    const s = JSON.stringify(e);
    expect(s).not.toContain('Custodial');
    expect(s).not.toContain('quote list');
    expect(s).not.toContain('co.jones');
  });

  it('a content refusal reaches no account lookup and no provider', async () => {
    const { tool, list, createDraft } = setup();
    expect(await tool.execute({ ...ARGS, body: 'We are a HUBZone firm. —' })).toMatchObject({ ok: false });
    expect(list).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
  });
});
