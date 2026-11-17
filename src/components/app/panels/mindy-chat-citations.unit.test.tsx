/**
 * Citation chips (review on #2106): a SAM.gov notice citation opens its SAM.gov link, never the Knowledge Base,
 * including an older saved answer that still carries the notice id in document_id.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../authHeaders', () => ({ authedFetch: vi.fn() }));
vi.mock('../UpgradeModal', () => ({ UpgradeModal: () => null }));

import { citationTarget } from './MindyChatPanel';

const SAM = 'https://sam.gov/opp/x/view';

describe('citationTarget', () => {
  it('a sam_notice citation is the SAM.gov link (document_id null, as the route now sends it)', () => {
    expect(citationTarget({ doc_type: 'sam_notice', url: SAM, document_id: null })).toBe('url');
  });
  it('an older saved sam_notice citation with the notice id in document_id is still the SAM link, not a KB button', () => {
    expect(citationTarget({ doc_type: 'sam_notice', url: SAM, document_id: '6ba812a7e0284f79bc44c4932777c340' })).toBe('url');
  });
  it('a real Knowledge Base doc still opens the Knowledge Base', () => {
    expect(citationTarget({ doc_type: 'course_material', url: null, document_id: 'kb-1' })).toBe('kb');
  });
  it('nothing to open → plain', () => {
    expect(citationTarget({ doc_type: 'sam_notice', url: null, document_id: null })).toBe('none');
  });
});
