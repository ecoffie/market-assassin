import type { SectionType } from './types';

type NoticeFamily = 'sources_sought' | 'rfi' | 'rfq' | 'rfp' | 'unknown';

const LOI_SECTION_TYPES = new Set<SectionType>([
  'company_overview',
  'cap_past_performance',
  'capabilities',
  'differentiators',
  'poc',
]);

export function inferProposalNoticeFamily(sourceText: string, sectionType: SectionType): NoticeFamily {
  if (LOI_SECTION_TYPES.has(sectionType)) return 'sources_sought';

  const head = sourceText.slice(0, 5000).toLowerCase();
  if (
    head.includes('sources sought') ||
    head.includes('source sought') ||
    head.includes('statement of capability') ||
    head.includes('market research') ||
    head.includes('not a request for proposal') ||
    head.includes('not a solicitation')
  ) {
    return 'sources_sought';
  }
  if (head.includes('request for information') || /\brfi\b/.test(head)) return 'rfi';
  if (head.includes('request for quotation') || /\brfq\b/.test(head)) return 'rfq';
  if (head.includes('request for proposal') || /\brfp\b/.test(head) || head.includes('offerors shall')) return 'rfp';
  return 'unknown';
}

export function buildTemplateCorpusQuery(opts: {
  sectionLabel: string;
  sectionType: SectionType;
  sourceText: string;
}): string {
  const noticeFamily = inferProposalNoticeFamily(opts.sourceText, opts.sectionType);
  const snippet = opts.sourceText.slice(0, 1000).replace(/\s+/g, ' ');
  const formatIntent =
    noticeFamily === 'sources_sought'
      ? 'Sources Sought LOI statement of capability response format relevant experience company profile'
      : noticeFamily === 'rfi'
        ? 'RFI response LOI statement of capability format requested information'
        : noticeFamily === 'rfq'
          ? 'RFQ quote response pricing submittal template'
          : 'RFP proposal volume template evaluation factors compliance response format';

  return `${opts.sectionLabel} ${formatIntent} ${snippet}`;
}

export function getTemplateCorpusDocTypes(sectionType: SectionType, sourceText: string): string[] {
  const noticeFamily = inferProposalNoticeFamily(sourceText, sectionType);

  if (noticeFamily === 'sources_sought') {
    return [
      'sources_sought_loi',
      'rfi_response',
      'cap_statement',
      'past_performance',
      'proposal_template',
      'course_material',
    ];
  }

  if (noticeFamily === 'rfi') {
    return [
      'rfi_response',
      'sources_sought_loi',
      'cap_statement',
      'past_performance',
      'proposal_template',
      'course_material',
    ];
  }

  if (noticeFamily === 'rfq') {
    return [
      'rfq_response',
      'pricing_volume',
      'proposal_template',
      'past_performance',
      'course_material',
    ];
  }

  // Prefer REAL winning NARRATIVES over meta "outline writer" templates (Eric QC:
  // a technical draft pulled a 'Proposal Outline Writer Prompt' template and
  // wrote "Agile sprints" for a CONSTRUCTION job). Lead with the actual volume
  // examples; proposal_template/course_material are last-resort filler only.
  if (sectionType === 'past_performance' || sectionType === 'cap_past_performance') {
    return ['past_performance', 'technical_volume', 'cap_statement', 'proposal_template'];
  }
  if (sectionType === 'technical') {
    // proposal_subdoc = the real QCP / Safety / Accident Prevention / CMP
    // examples — the Volume I components a technical draft must mirror.
    return ['technical_volume', 'proposal_subdoc', 'past_performance', 'cap_statement', 'proposal_template'];
  }
  if (sectionType === 'management') {
    return ['management_volume', 'proposal_subdoc', 'technical_volume', 'past_performance', 'proposal_template'];
  }
  if (sectionType === 'pricing') {
    return ['pricing_volume', 'rfq_response', 'technical_volume', 'proposal_template'];
  }

  return ['proposal_template', 'technical_volume', 'course_material', 'webinar_resource', 'teaching_handout'];
}
