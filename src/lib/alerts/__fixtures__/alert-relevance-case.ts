/**
 * FROZEN CASE — a real daily alert, 2026-09-24, SDVOSB AI/acquisition-support firm.
 *
 * Rows are REAL sam_opportunities notices (titles, agencies, stage, set-aside and
 * deadlines verbatim). `description` is an EXCERPT: only the real passages around
 * each saved-keyword hit (±70 chars), joined with " … " — enough to reproduce the
 * matcher's evidence without committing full notice bodies.
 *
 * What went wrong on the live email (investigation: tasks/daily-alert-relevance-2026-09-26.md):
 *   - 6 of 7 notices scored a clamped 100, so order fell to the deadline.
 *   - "NIST" gave FDA and the Federal Highway Administration +30 (admi-NIST-ration).
 *   - "VA" never matched Veterans Affairs.
 *   - A Special Notice ceiling increase was listed as open work.
 *   - The one TITLE-level AI match in his market was not in the email at all.
 * Customer identity is deliberately not recorded here.
 */
import type { SAMOpportunity } from '@/lib/briefings/pipelines/sam-gov';

/** The instant the alert was sent — pin the clock to this so deadline points match. */
export const CASE_SENT_AT = '2026-09-24T03:44:00Z';

export const CASE_PROFILE = {
  naics_codes: ['518210','541330','541511','541512','541519','541611','541618','541690','541990','611420','611430','611710'],
  agencies: ['HHS','VA','GSA','DOE','NASA','DOT','USDA','State','Commerce','FRA','FAA','NARA','DHS','CISA','DOD','Army','Navy','Air Force','NIST','NSF'],
  keywords: [
    "artificial intelligence",
    "AI governance",
    "AI risk management",
    "responsible AI",
    "generative AI",
    "intelligent automation",
    "workflow automation",
    "process automation",
    "digital transformation",
    "application modernization",
    "software development",
    "systems integration",
    "data analytics",
    "data management",
    "decision support",
    "operational intelligence",
    "business intelligence",
    "information management",
    "case management",
    "knowledge management",
    "records management",
    "evidence management",
    "program management",
    "project management",
    "acquisition support",
    "acquisition modernization",
    "procurement modernization",
    "contract management",
    "compliance",
    "auditability",
    "traceability",
    "provenance",
    "human oversight",
    "human-in-the-loop",
    "cybersecurity",
    "cloud modernization",
    "FedRAMP",
    "FISMA",
    "data governance",
    "privacy"
  ],
  business_type: 'SDVOSB',
  business_description: null,
  setAsides: [] as string[],
};

interface CaseRow {
  noticeId: string; title: string; naicsCode: string; department: string; subTier: string;
  noticeType: string; setAside: string | null; setAsideDescription: string | null;
  responseDeadline: string | null; postedDate: string; description: string;
}

export const CASE_ROWS: CaseRow[] = [
  {
    "noticeId": "1f7164cbd60046d7a23678be5d461930",
    "title": "PTAG RFI: USPTO seeks Contractor to Review and Revise the Patent Examiner Training program.",
    "naicsCode": "611430",
    "department": "COMMERCE, DEPARTMENT OF",
    "subTier": "US PATENT AND TRADEMARK OFFICE",
    "noticeType": "Sources Sought",
    "setAside": "NONE",
    "setAsideDescription": "No Set aside used",
    "responseDeadline": "2026-09-28T17:00:00+00:00",
    "postedDate": "2026-09-23T00:00:00+00:00",
    "description": "atents that allow examiners to generate correspondence to applicants, case management tools. Ability to deliver professional training that is consistent \u2026 our firm&rsquo;s capacity to support this effort, including staffing, project management approach, relevant experience, and any assumptions or constraints tha \u2026 Experience in incorporating clean visuals, graphics, and ensuring 508-compliance of all materials. Experience in graphic design, visual clarity, and"
  },
  {
    "noticeId": "1f8b43b050fe40fe916cb9ced7cbdbfc",
    "title": "Surface Transportation Systems Engineering for Enabling Technologies Research and Development",
    "naicsCode": "541990",
    "department": "TRANSPORTATION, DEPARTMENT OF",
    "subTier": "FEDERAL HIGHWAY ADMINISTRATION",
    "noticeType": "Special Notice",
    "setAside": "NONE",
    "setAsideDescription": "No Set aside used",
    "responseDeadline": "2026-10-01T18:00:00+00:00",
    "postedDate": "2026-09-14T00:00:00+00:00",
    "description": "on investigating and evaluating emerging technologies&mdash;including artificial intelligence (AI), edge computing, radio frequency (RF) spectrum and communication \u2026 ons, network engineering, position, navigation, and timing (PNT), and cybersecurity&mdash;to improve safety and efficiency across surface transportation"
  },
  {
    "noticeId": "76f2d8df645c4acca700b00ffe276bff",
    "title": "PMS 470 Professional Support Services - RFP",
    "naicsCode": "541330",
    "department": "DEPT OF DEFENSE",
    "subTier": "DEPT OF THE NAVY",
    "noticeType": "Solicitation",
    "setAside": "SBA",
    "setAsideDescription": "Small Business Set Aside - Total",
    "responseDeadline": "2026-10-01T20:00:00+00:00",
    "postedDate": "2026-09-02T00:00:00+00:00",
    "description": "ed Logistics Support, Program Support and Management, Acquisition and Contract Management, Business and Financial Management, and Integrated Performance Analys"
  },
  {
    "noticeId": "81ab7b4434bf44008652216a24ec6b03",
    "title": "FedRAMP Webex Subscription Maintenance",
    "naicsCode": "541519",
    "department": "FEDERAL DEPOSIT INSURANCE CORPORATION",
    "subTier": "FEDERAL DEPOSIT INSURANCE CORPORATION",
    "noticeType": "Solicitation",
    "setAside": "NONE",
    "setAsideDescription": "No Set aside used",
    "responseDeadline": "2026-10-02T16:00:00+00:00",
    "postedDate": "2026-09-22T00:00:00+00:00",
    "description": "e provided via Amendment 0002. Solicitation Number CORHQ-26-Q-0369: FedRAMP Webex Subscription Maintenance Please complete and submit the foll"
  },
  {
    "noticeId": "83bdf90589044beaa80e8c1a4ec76791",
    "title": "Think Trends Software Implementation and Support",
    "naicsCode": "541511",
    "department": "HEALTH AND HUMAN SERVICES, DEPARTMENT OF",
    "subTier": "FOOD AND DRUG ADMINISTRATION",
    "noticeType": "Solicitation",
    "setAside": "SBA",
    "setAsideDescription": "Small Business Set Aside - Total",
    "responseDeadline": "2026-09-28T17:00:00+00:00",
    "postedDate": "2026-09-22T00:00:00+00:00",
    "description": "Document AI, OCR, ICR, and NLP capabilities; RPA and intelligent workflow automation; AI/ML lifecycle management and related MLOps activities; Analyti \u2026 alidation, auditability, and operational support; Agile project and program management; Training and knowledge transfer; Transition and continuity-of-op \u2026 data sources; Application development and enhancement; Security, compliance, validation, auditability, and operational support; Agile project a \u2026 tion development and enhancement; Security, compliance, validation, auditability, and operational support; Agile project and program management; T"
  },
  {
    "noticeId": "9d147a108bf242959a7001428f9b1324",
    "title": "PMA-231 Program/Project Management Support Services",
    "naicsCode": "541330",
    "department": "DEPT OF DEFENSE",
    "subTier": "DEPT OF THE NAVY",
    "noticeType": "Combined Synopsis/Solicitation",
    "setAside": "SBA",
    "setAsideDescription": "Small Business Set Aside - Total",
    "responseDeadline": "2026-10-02T18:00:00+00:00",
    "postedDate": "2026-09-17T00:00:00+00:00",
    "description": ""
  },
  {
    "noticeId": "e49266076d7848a09bfecb4be1c409f0",
    "title": "MTCCS II Ceiling Increase",
    "naicsCode": "541990",
    "department": "DEPT OF DEFENSE",
    "subTier": "DEPT OF THE ARMY",
    "noticeType": "Special Notice",
    "setAside": "NONE",
    "setAsideDescription": "No Set aside used",
    "responseDeadline": "2026-10-01T17:30:00+00:00",
    "postedDate": "2026-09-16T00:00:00+00:00",
    "description": "OC encompass non-personal operational, technical, administrative, and program management services supporting individual through collective MC training. T"
  },
  {
    "noticeId": "6a4ca55e1e4544fcb51d123c0d016d11",
    "title": "Enterprise Cybersecurity Services",
    "naicsCode": "541519",
    "department": "HOMELAND SECURITY, DEPARTMENT OF",
    "subTier": "US SECRET SERVICE",
    "noticeType": "Special Notice",
    "setAside": null,
    "setAsideDescription": null,
    "responseDeadline": null,
    "postedDate": "2026-08-27T00:00:00+00:00",
    "description": ""
  },
  {
    "noticeId": "ad537f8f7c044c7fadbe03e19193de21",
    "title": "VA Enterprise Artificial Intelligence Support Services",
    "naicsCode": "541519",
    "department": "VETERANS AFFAIRS, DEPARTMENT OF",
    "subTier": "VETERANS AFFAIRS, DEPARTMENT OF",
    "noticeType": "Sources Sought",
    "setAside": null,
    "setAsideDescription": null,
    "responseDeadline": "2026-10-07T14:00:00+00:00",
    "postedDate": "2026-09-22T00:00:00+00:00",
    "description": ""
  },
  {
    "noticeId": "78622cd865aa40ffb5aee48884d97dbf",
    "title": "ClaimsCore Enterprise Program Management Office (ePMO) Support",
    "naicsCode": "541519",
    "department": "HEALTH AND HUMAN SERVICES, DEPARTMENT OF",
    "subTier": "CENTERS FOR MEDICARE AND MEDICAID SERVICES",
    "noticeType": "Justification",
    "setAside": null,
    "setAsideDescription": null,
    "responseDeadline": null,
    "postedDate": "2026-09-16T00:00:00+00:00",
    "description": "nt Point of Entry for a minimum of 30 days. CMS requires enterprise program management office (ePMO) support services for the ClaimsCore initiative, a large"
  },
  {
    "noticeId": "657bdbda0e554843bb53ddf6c01bd2e7",
    "title": "Warehouse Support Services Recompete",
    "naicsCode": "541330",
    "department": "DEPT OF DEFENSE",
    "subTier": "DEPT OF THE NAVY",
    "noticeType": "Solicitation",
    "setAside": "SDVOSBC",
    "setAsideDescription": "Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside (FAR 19.14)",
    "responseDeadline": "2026-10-07T05:00:00+00:00",
    "postedDate": "2026-09-17T00:00:00+00:00",
    "description": "ortunity to review Government findings identified during the proposal compliance review and updates made within the Solicitation package; and, as appl"
  }
];

/** Fill the SAMOpportunity fields the scorer doesn't read. */
export function asOpportunity(r: CaseRow): SAMOpportunity {
  return {
    solicitationNumber: '', classificationCode: '', office: '', archiveDate: '', active: true,
    placeOfPerformance: {}, uiLink: `https://sam.gov/opp/${r.noticeId}/view`, lastModifiedDate: r.postedDate,
    ...r,
    responseDeadline: r.responseDeadline ?? '',
  };
}
