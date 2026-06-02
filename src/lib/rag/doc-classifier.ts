export const FORMAT_DOC_TYPES = [
  'sources_sought_loi',
  'rfi_response',
  'rfq_response',
  'technical_volume',
  'management_volume',
  'pricing_volume',
] as const;

export type FormatDocType = typeof FORMAT_DOC_TYPES[number];

interface ClassifyInput {
  filename?: string | null;
  title?: string | null;
  sourcePath?: string | null;
  currentDocType?: string | null;
}

export interface RagDocTypeSuggestion {
  suggestedDocType: FormatDocType | 'cap_statement' | 'past_performance';
  confidence: 'high' | 'medium';
  reason: string;
}

const PROTECTED_TEACHING_TYPES = new Set([
  'podcast_interview',
  'webinar_resource',
  'qa_dataset',
  'ebook',
]);

function isProtectedTeachingDoc(input: ClassifyInput): boolean {
  const current = input.currentDocType || '';
  const sourcePath = (input.sourcePath || '').toLowerCase();
  return PROTECTED_TEACHING_TYPES.has(current) || sourcePath.includes('govcon-giants-podcast');
}

function hasResponseIntent(text: string): boolean {
  return (
    text.includes('response') ||
    text.includes('responding') ||
    text.includes('proposal') ||
    text.includes('submittal') ||
    text.includes('template') ||
    text.includes('sample')
  );
}

function hasLoiIntent(text: string): boolean {
  return (
    /\bss\s*-\s*loi\b/.test(text) ||
    /\bloi\b/.test(text) ||
    text.includes('letter of intent') ||
    text.includes('sample_loi') ||
    text.includes('sources sought template') ||
    text.includes('sources sought tempate')
  );
}

export function classifyRagDocCandidate(input: ClassifyInput): RagDocTypeSuggestion | null {
  const fileTitle = [input.filename || '', input.title || ''].join(' ').toLowerCase();
  const protectedTeaching = isProtectedTeachingDoc(input);

  const actualDocumentOnly = (suggestion: RagDocTypeSuggestion): RagDocTypeSuggestion | null => {
    if (protectedTeaching) return null;
    return suggestion;
  };

  if (hasLoiIntent(fileTitle)) {
    return actualDocumentOnly({
      suggestedDocType: 'sources_sought_loi',
      confidence: 'high',
      reason: 'filename/title indicates an LOI or Sources Sought LOI document',
    });
  }

  if (fileTitle.includes('statement of capability') && (fileTitle.includes('sources sought') || fileTitle.includes('source sought'))) {
    return actualDocumentOnly({
      suggestedDocType: 'sources_sought_loi',
      confidence: 'high',
      reason: 'statement-of-capability document tied to Sources Sought language',
    });
  }

  if (
    hasResponseIntent(fileTitle) &&
    (/\brfi\b/.test(fileTitle) || fileTitle.includes('request for information'))
  ) {
    return actualDocumentOnly({
      suggestedDocType: 'rfi_response',
      confidence: 'medium',
      reason: 'filename/title indicates RFI response material',
    });
  }

  if (
    fileTitle.includes('quote response') ||
    fileTitle.includes('quote proposal') ||
    (
      hasResponseIntent(fileTitle) &&
      (/\brfq\b/.test(fileTitle) || fileTitle.includes('request for quotation'))
    )
  ) {
    return actualDocumentOnly({
      suggestedDocType: 'rfq_response',
      confidence: 'high',
      reason: 'filename/title indicates RFQ or quote response material',
    });
  }

  if (
    fileTitle.includes('volume i - technical') ||
    fileTitle.includes('vol 1_technical') ||
    fileTitle.includes('vol 1 technical') ||
    fileTitle.includes('vol i technical') ||
    fileTitle.includes('technical proposal') ||
    fileTitle.includes('technical approach sample')
  ) {
    return actualDocumentOnly({
      suggestedDocType: 'technical_volume',
      confidence: 'high',
      reason: 'filename/title indicates a technical proposal volume',
    });
  }

  if (fileTitle.includes('management volume') || fileTitle.includes('management approach') || fileTitle.includes('staffing plan')) {
    return actualDocumentOnly({
      suggestedDocType: 'management_volume',
      confidence: 'medium',
      reason: 'filename/title indicates management proposal material',
    });
  }

  if (
    !fileTitle.includes('non-price proposal') &&
    !fileTitle.includes('non price proposal') &&
    (
      fileTitle.includes('price proposal') ||
      fileTitle.includes('pricing volume') ||
      fileTitle.includes('price volume') ||
      fileTitle.includes('cost volume')
    )
  ) {
    return actualDocumentOnly({
      suggestedDocType: 'pricing_volume',
      confidence: 'high',
      reason: 'filename/title indicates pricing or cost proposal material',
    });
  }

  if (fileTitle.includes('cap statement') || fileTitle.includes('capability statement')) {
    return actualDocumentOnly({
      suggestedDocType: 'cap_statement',
      confidence: 'high',
      reason: 'filename/title indicates a capability statement document',
    });
  }

  if (fileTitle.includes('past performance') || fileTitle.includes('volume ii_past performance')) {
    return actualDocumentOnly({
      suggestedDocType: 'past_performance',
      confidence: 'high',
      reason: 'filename/title indicates past performance proposal material',
    });
  }

  return null;
}
