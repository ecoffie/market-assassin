import { describe, it, expect } from 'vitest';
import {
  parseChatHandoff,
  parseMapSelectedOpp,
  parseLastChatSessionId,
  serializeMapSelectedOpp,
  opportunityContextField,
} from './chat-handoff';

const NID = '6ba812a7e0284f79bc44c4932777c340';

describe('parseChatHandoff', () => {
  it('reads the drawer payload', () => {
    expect(parseChatHandoff(JSON.stringify({ v: 1, sessionId: '11111111-2222-4333-8444-555555555555', context: { kind: 'opportunity', notice_id: NID.toUpperCase(), title: 'T', deadline: '2026-12-04' } })))
      .toEqual({ sessionId: '11111111-2222-4333-8444-555555555555', opportunity: { notice_id: NID, title: 'T', deadline: '2026-12-04' } });
    expect(parseChatHandoff(JSON.stringify({ v: 1, sessionId: 'abc', context: null }))).toEqual({ sessionId: 'abc', opportunity: null });
  });
  it('rejects junk, other versions, non-SAM ids and odd session ids', () => {
    for (const raw of [null, '', 'nope', '{}', JSON.stringify({ v: 2, sessionId: 'a' }),
      JSON.stringify({ v: 1, sessionId: '../x', context: { kind: 'opportunity', notice_id: 'W912PL26Q0042' } }),
      JSON.stringify({ v: 1, context: { kind: 'award', notice_id: NID } })]) {
      expect(parseChatHandoff(raw)).toBeNull();
    }
  });
  it('the request field carries only the id', () => {
    expect(opportunityContextField({ notice_id: NID, title: 'T', deadline: 'd' })).toEqual({ context: { kind: 'opportunity', notice_id: NID } });
    expect(opportunityContextField(null)).toEqual({});
  });
});

describe('parseMapSelectedOpp', () => {
  it('reads a live Map selection and clears on null context', () => {
    expect(parseMapSelectedOpp(serializeMapSelectedOpp({ notice_id: NID, title: 'Bridge', deadline: '2026-12-04' })))
      .toEqual({ notice_id: NID, title: 'Bridge', deadline: '2026-12-04' });
    expect(parseMapSelectedOpp(serializeMapSelectedOpp(null))).toBeNull();
  });
  it('rejects non-SAM ids and junk', () => {
    expect(parseMapSelectedOpp(JSON.stringify({ v: 1, context: { kind: 'opportunity', notice_id: 'N0016426R0012' } }))).toBeNull();
    expect(parseMapSelectedOpp('nope')).toBeNull();
  });
});

describe('parseLastChatSessionId', () => {
  it('accepts a normal session id and rejects path junk', () => {
    expect(parseLastChatSessionId('11111111-2222-4333-8444-555555555555')).toBe('11111111-2222-4333-8444-555555555555');
    expect(parseLastChatSessionId('../x')).toBeNull();
    expect(parseLastChatSessionId(null)).toBeNull();
  });
});
