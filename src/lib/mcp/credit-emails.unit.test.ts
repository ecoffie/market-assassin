import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEmail = vi.fn();
vi.mock('@/lib/send-email', () => ({ sendEmail: (args: unknown) => sendEmail(args) }));

import { sendCreditReceiptEmail, sendCreditWelcomeEmail } from './credit-emails';

beforeEach(() => {
  vi.clearAllMocks();
  sendEmail.mockResolvedValue(true);
});

describe('sendCreditReceiptEmail', () => {
  it('top-up receipt: transactional, right type, amount + balance in the body', async () => {
    await sendCreditReceiptEmail({ email: 'B@X.com', kind: 'topup', credits: 2000, newBalance: 2100, amountUsd: 49, reference: 'cs_1' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const a = sendEmail.mock.calls[0][0];
    expect(a.transactional).toBe(true);
    expect(a.emailType).toBe('mcp_credit_receipt');
    expect(a.eventSource).toBe('mcp_topup');
    expect(a.to).toBe('B@X.com');
    expect(a.subject).toContain('2,000');
    expect(a.html).toContain('$49.00');
    expect(a.html).toContain('2,100 credits'); // new balance
    expect(a.html).toContain('cs_1'); // reference
    expect(a.text).toContain('Amount paid: $49.00');
  });

  it('subscription receipt: plan + interval reflected', async () => {
    await sendCreditReceiptEmail({ email: 'u@x.com', kind: 'subscription', credits: 2400, newBalance: 2400, amountUsd: 59, reference: 'INV-9', planLabel: 'Starter', interval: 'month' });
    const a = sendEmail.mock.calls[0][0];
    expect(a.eventSource).toBe('mcp_subscription');
    expect(a.subject).toContain('Starter');
    expect(a.html).toContain('Starter');
    expect(a.html).toContain('/mo');
  });

  it('auto-recharge receipt: uses the auto-recharge copy', async () => {
    await sendCreditReceiptEmail({ email: 'u@x.com', kind: 'auto_recharge', credits: 5000, newBalance: 5010, amountUsd: 99, reference: 'pi_1' });
    const a = sendEmail.mock.calls[0][0];
    expect(a.eventSource).toBe('mcp_auto_recharge');
    expect(a.html.toLowerCase()).toContain('auto');
  });

  it('omits the amount row cleanly when amountUsd is null', async () => {
    await sendCreditReceiptEmail({ email: 'u@x.com', kind: 'topup', credits: 100, newBalance: 100, amountUsd: null, reference: 'cs_2' });
    const a = sendEmail.mock.calls[0][0];
    expect(a.html).not.toContain('Amount paid');
  });

  it('never throws when the send fails', async () => {
    sendEmail.mockRejectedValue(new Error('provider down'));
    await expect(
      sendCreditReceiptEmail({ email: 'u@x.com', kind: 'topup', credits: 100, newBalance: 100 }),
    ).resolves.toBeUndefined();
  });
});

describe('sendCreditWelcomeEmail', () => {
  it('welcome: right type + free-credit framing', async () => {
    await sendCreditWelcomeEmail({ email: 'new@x.com', credits: 100 });
    const a = sendEmail.mock.calls[0][0];
    expect(a.transactional).toBe(true);
    expect(a.emailType).toBe('mcp_credit_welcome');
    expect(a.subject).toContain('100 free');
    expect(a.html).toContain('100 free credits');
  });
});
