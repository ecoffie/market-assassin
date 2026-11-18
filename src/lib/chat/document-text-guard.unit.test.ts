/**
 * Prompt-injection guard for document text in the planner (Agent 4 MED on #2138):
 *   - restrictWritesWhenDocumentText keeps read tools + create_document, drops every other write (policy-driven);
 *   - isDocumentCreationRequest decides which turns give the planner uploaded text at all.
 */
import { describe, it, expect } from 'vitest';
import { restrictWritesWhenDocumentText, DOCUMENT_TEXT_WRITE_TOOL } from './tool-selection';
import { chatToolPolicy } from './chat-tool-policy';
import { isDocumentCreationRequest } from './generate-document-tool';

const def = (name: string) => ({ type: 'function' as const, function: { name } });
const policy = (name: string) => chatToolPolicy(name, true);

describe('restrictWritesWhenDocumentText', () => {
  it('keeps read tools and create_document; drops every other write the chat policy allows', () => {
    const names = ['find_my_documents', 'search_my_vault', 'get_my_pipeline', 'find_opportunities', 'create_document',
      'schedule_market_search', 'update_market_schedule', 'delete_market_schedule', 'add_contacts_to_crm', 'generate_market_report'];
    const r = restrictWritesWhenDocumentText(names.map(def), policy);
    expect(r.defs.map((d) => d.function.name)).toEqual(['find_my_documents', 'search_my_vault', 'get_my_pipeline', 'find_opportunities', 'create_document']);
    expect(r.removed).toEqual(['schedule_market_search', 'update_market_schedule', 'delete_market_schedule', 'add_contacts_to_crm', 'generate_market_report']);
  });

  it('find_my_documents stays available (chat-private read tool); create_document is the one write kept', () => {
    expect(policy('find_my_documents').decision).toBe('allowed_read');
    expect(DOCUMENT_TEXT_WRITE_TOOL).toBe('create_document');
    expect(policy('create_document').decision).toBe('allowed_write');
  });

  it('is policy-driven: a write added later (not named here) is dropped too', () => {
    const r = restrictWritesWhenDocumentText([def('future_write_tool')], () => ({ decision: 'allowed_write' }));
    expect(r.removed).toEqual(['future_write_tool']);
  });
});

describe('isDocumentCreationRequest (only then does the planner see uploaded text)', () => {
  it.each([
    'Create my improved capability statement as a document',
    'Can you make this into a PDF?',
    'export that as a Word file',
    'Turn this into a one-pager',
    'Please write up a report on the Georgia market',
    'save it as a docx',
    'give me a PDF of the rewrite',
  ])('document request: %s', (t) => expect(isDocumentCreationRequest(t)).toBe(true));

  it.each([
    'What does my capability statement say about QA?',
    'Find janitorial opportunities in Georgia',
    'Who are the top buyers? Also, my document mentions floor care.',
    'Make sure the list includes VA offices',
    'Delete my saved search',
    '',
  ])('not a document request: %s', (t) => expect(isDocumentCreationRequest(t)).toBe(false));
});
