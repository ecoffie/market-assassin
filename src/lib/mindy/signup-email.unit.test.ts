import { describe, it, expect } from 'vitest';
import { signupEmailFormatError, isInvalidRecipientError } from './signup-email';

describe('signupEmailFormatError — valid addresses still pass', () => {
  it.each([
    'jane@example.com',
    'jane.doe@example.com',
    'j.a.n.e@example.com',
    'jane+mindy@example.co.uk',
    "o'neil@example.com",
    'first_last-1@sub.example.org',
    'a@b.io',
    '1234@example.com',
  ])('%s → null', (email) => {
    expect(signupEmailFormatError(email)).toBeNull();
  });
});

describe('signupEmailFormatError — mistyped dots are rejected with a helpful message', () => {
  it('consecutive dots (the 2026-10-25 incident shape)', () => {
    const err = signupEmailFormatError('ab.cde..f.g.hi.j.k.lm.1.234@abcde.com');
    expect(err).toMatch(/mistyped/i);
    expect(err).toMatch(/two dots in a row/);
  });
  it('three dots in a row', () => {
    expect(signupEmailFormatError('a...b@example.com')).toMatch(/two dots in a row/);
  });
  it('leading dot', () => {
    expect(signupEmailFormatError('.jane@example.com')).toMatch(/starts with a dot/);
  });
  it('dot immediately before the @', () => {
    expect(signupEmailFormatError('jane.@example.com')).toMatch(/dot right before the @/);
  });
  it('a dot-only local part', () => {
    expect(signupEmailFormatError('.@example.com')).toMatch(/mistyped/);
  });
});

describe('signupEmailFormatError — pre-existing format rules unchanged', () => {
  it.each(['', 'no-at-sign', 'a@b', 'a@@b.com', 'a b@example.com', 'a@exa mple.com', 'a@.example.com'])(
    '%j → "Invalid email format"',
    (email) => {
      expect(signupEmailFormatError(email)).toBe('Invalid email format');
    },
  );
});

// Shapes taken from production (nodemailer error rethrown by sendEmail after the Resend 422).
const prodRecipientRejection = Object.assign(new Error("Can't send mail - all recipients were rejected: 501 5.1.3 Invalid address"), {
  code: 'EENVELOPE',
  response: '501 5.1.3 Invalid address',
  responseCode: 501,
  command: 'RCPT TO',
});
const smtp = (command: string, responseCode: number | undefined, response: string, code = 'EENVELOPE') =>
  Object.assign(new Error(response || code), { command, responseCode, response, code });

describe('isInvalidRecipientError — permanent recipient-address rejections → true', () => {
  it('the exact production error (501 5.1.3 at RCPT TO)', () => {
    expect(isInvalidRecipientError(prodRecipientRejection)).toBe(true);
  });
  it('550 5.1.1 bad destination mailbox', () => {
    expect(isInvalidRecipientError(smtp('RCPT TO', 550, '550 5.1.1 User unknown'))).toBe(true);
  });
  it('550 5.1.10 recipient not found (Office 365)', () => {
    expect(isInvalidRecipientError(smtp('RCPT TO', 550, '550 5.1.10 RESOLVER.ADR.RecipientNotFound; not found'))).toBe(true);
  });
  it('bare 501 at RCPT TO (syntax error in the address)', () => {
    expect(isInvalidRecipientError(smtp('RCPT TO', 501, '501 Syntax error in parameters'))).toBe(true);
  });
});

describe('isInvalidRecipientError — outages, rate limits and policy stay server errors → false', () => {
  it.each([
    ['timeout, no SMTP reply', Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT', command: 'CONN' })],
    ['connection refused', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNECTION' })],
    ['DNS failure', Object.assign(new Error('getaddrinfo ENOTFOUND smtp.office365.com'), { code: 'EDNS' })],
    ['auth failure', smtp('AUTH LOGIN', 535, '535 5.7.3 Authentication unsuccessful', 'EAUTH')],
    ['rate limited at RCPT (4xx)', smtp('RCPT TO', 452, '452 4.5.3 Too many recipients')],
    ['temporary failure at RCPT (421)', smtp('RCPT TO', 421, '421 4.3.2 Service not available')],
    ['greylisted (450 4.2.0)', smtp('RCPT TO', 450, '450 4.2.0 Try again later')],
    ['relay/policy denied at RCPT (5.7.x)', smtp('RCPT TO', 550, '550 5.7.1 Relaying denied')],
    ['routing failure at RCPT (5.4.x)', smtp('RCPT TO', 554, '554 5.4.4 Unable to route')],
    ['sender rejected at MAIL FROM (5.1.8)', smtp('MAIL FROM', 550, '550 5.1.8 Sender address rejected')],
    ['message rejected at DATA', smtp('DATA', 554, '554 5.6.0 Message rejected')],
    ['550 at RCPT with non-address enhanced code', smtp('RCPT TO', 550, '550 5.2.2 Mailbox full')],
    ['a Resend-style plain error (outage)', new Error('Internal server error')],
    ['a non-error value', 'boom'],
    ['null', null],
    ['undefined', undefined],
  ])('%s', (_label, err) => {
    expect(isInvalidRecipientError(err)).toBe(false);
  });
});
