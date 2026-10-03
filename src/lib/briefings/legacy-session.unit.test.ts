import { describe, expect, it } from 'vitest';
import { briefingsEntry } from './legacy-session';

describe('/briefings entry: only a signed session is identity', () => {
  it('session → load that account', () => {
    expect(briefingsEntry({ sessionEmail: 'A@x.com' })).toEqual({ kind: 'session', email: 'a@x.com' });
  });
  it('remembered plaintext email without a session → verify first, never load', () => {
    expect(briefingsEntry({ sessionEmail: null, legacyEmail: 'a@x.com' })).toEqual({ kind: 'needs_verification', hintEmail: 'a@x.com' });
  });
  it('?email= for another account than the session → verify that address', () => {
    expect(briefingsEntry({ sessionEmail: 'a@x.com', urlEmail: 'b@x.com' })).toEqual({ kind: 'needs_verification', hintEmail: 'b@x.com' });
  });
  it('?email= matching the session → load', () => {
    expect(briefingsEntry({ sessionEmail: 'a@x.com', urlEmail: 'A@x.com' }).kind).toBe('session');
  });
  it('nothing known → anonymous', () => {
    expect(briefingsEntry({ sessionEmail: null })).toEqual({ kind: 'anonymous' });
  });
});
