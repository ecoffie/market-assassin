import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveApplication = vi.fn();
const sendApplicationReceivedEmail = vi.fn(async () => true);
const notifySlackOfApplication = vi.fn(async () => true);

vi.mock('@/lib/rate-limit', () => ({
  getClientIP: () => '1.2.3.4',
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));
vi.mock('@/lib/ambassadors/store', () => ({ saveApplication: (...a: unknown[]) => saveApplication(...a) }));
vi.mock('@/lib/ambassadors/emails', () => ({ sendApplicationReceivedEmail: (...a: unknown[]) => sendApplicationReceivedEmail(...(a as [])) }));
vi.mock('@/lib/ambassadors/application', async (orig) => ({
  ...(await orig<typeof import('@/lib/ambassadors/application')>()),
  notifySlackOfApplication: (...a: unknown[]) => notifySlackOfApplication(...(a as [])),
}));

const { POST } = await import('./route');

const good = {
  name: 'Sue Kranes',
  email: 'sue@example.com',
  postUrl: 'https://linkedin.com/in/sue',
  company: 'Kranes Federal LLC',
  uei: 'ABC123456789',
  lastEvent: 'Fort Bragg Small Business Industry Day',
  pursuit: 'Sources sought response to Army MICC for grounds maintenance',
  wantToFind: 'Which offices buy grounds maintenance in my state',
  attested: true,
};

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/ambassadors/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

beforeEach(() => {
  saveApplication.mockReset();
  sendApplicationReceivedEmail.mockClear();
  notifySlackOfApplication.mockClear();
});

describe('POST /api/ambassadors/apply', () => {
  it('saves a complete application and sends the confirmation', async () => {
    saveApplication.mockResolvedValue({ status: 'saved' });
    const res = await post(good);
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(saveApplication).toHaveBeenCalledWith(expect.objectContaining({ uei: 'ABC123456789', company: 'Kranes Federal LLC', attested: true }));
    expect(sendApplicationReceivedEmail).toHaveBeenCalledWith('sue@example.com', 'Sue Kranes');
    expect(notifySlackOfApplication).toHaveBeenCalled();
  });

  it('returns 400 naming the bad fields and saves nothing', async () => {
    const res = await post({ ...good, uei: '123', attested: false });
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.errors.sort()).toEqual(['attested', 'uei']);
    expect(saveApplication).not.toHaveBeenCalled();
  });

  it('silently accepts a honeypot submission without storing it', async () => {
    const res = await post({ ...good, website2: 'spam' });
    expect(res.status).toBe(200);
    expect(saveApplication).not.toHaveBeenCalled();
  });

  it('returns 502 when the application cannot be saved', async () => {
    saveApplication.mockRejectedValue(new Error('kv down'));
    const res = await post(good);
    expect(res.status).toBe(502);
    expect(sendApplicationReceivedEmail).not.toHaveBeenCalled();
  });

  it('does not re-email an approved ambassador who applies again', async () => {
    saveApplication.mockResolvedValue({ status: 'already_ambassador' });
    const j = await (await post(good)).json();
    expect(j.alreadyAmbassador).toBe(true);
    expect(sendApplicationReceivedEmail).not.toHaveBeenCalled();
  });
});
