/**
 * A capability statement at real length (synthetic company, synthetic identifiers), shaped the way create_document
 * writes one: kind 'capability_statement', sections recognised by heading, every company fact citing a source.
 * Includes one unsourced Company Data line and one unverified competency, which must NOT reach the page.
 */
import { DOC_SCHEMA, type DocModel } from '../model';

export const CAPABILITY_STATEMENT: DocModel = {
  schema: DOC_SCHEMA,
  kind: 'capability_statement',
  title: 'Ridgeline Facility Services LLC Capability Statement',
  subtitle: 'Custodial, grounds and light HVAC maintenance for federal facilities across Georgia and South Carolina, with crews on site within 48 hours.',
  date: '2026-11-27',
  sources: [
    { id: 's-sam', kind: 'tool', label: 'SAM.gov entity registration: Ridgeline Facility Services LLC (synthetic)', recordId: 'RDGLN0000TEST' },
    { id: 's-upload', kind: 'upload', label: 'Ridgeline company overview.pdf (synthetic)', recordId: '00000000-0000-4000-8000-000000000001' },
    { id: 's-awards', kind: 'usaspending', label: 'USAspending award records: Ridgeline Facility Services LLC (synthetic)' },
  ],
  sections: [
    {
      id: 'sec-competencies', heading: 'Core Competencies',
      blocks: [{ type: 'bullets', id: 'b-comp', items: [
        { text: 'Daily and periodic custodial services for offices, clinics and training facilities, including floor care and restroom sanitation', claim: 'fact', cites: ['s-upload'] },
        { text: 'Grounds maintenance: mowing, edging, shrub care, leaf removal and storm cleanup on campuses up to 200 acres', claim: 'fact', cites: ['s-upload'] },
        { text: 'Preventive HVAC filter changes, coil cleaning and thermostat checks under a licensed mechanical subcontractor', claim: 'fact', cites: ['s-upload'] },
        { text: 'Green cleaning program using EPA Safer Choice products and microfiber systems', claim: 'fact', cites: ['s-upload'] },
        { text: 'Quality control plan with weekly inspections, photo logs and a 24-hour corrective action standard', claim: 'fact', cites: ['s-upload'] },
        { text: 'Surge staffing for move-ins, events and post-construction cleaning', claim: 'fact', cites: ['s-upload'] },
        { text: 'Trusted by every agency in the Southeast', claim: 'unverified' },
      ] }],
    },
    {
      id: 'sec-pp', heading: 'Past Performance',
      blocks: [{ type: 'table', id: 't-pp', claim: 'fact', cites: ['s-awards'], columns: [{ key: 'a', label: 'Agency' }, { key: 'w', label: 'Work' }, { key: 'v', label: 'Value' }], rows: [
        { a: 'USDA Forest Service, Francis Marion District', w: 'Janitorial services for district office and visitor center', v: '$412,000' },
        { a: 'Department of Veterans Affairs, Charleston VAMC', w: 'Grounds maintenance subcontract under a small business prime', v: '$186,500' },
        { a: 'Fort Stewart DPW (subcontract)', w: 'Post-construction cleaning for barracks renovation', v: '$94,000' },
      ] }],
    },
    {
      id: 'sec-diff', heading: 'Differentiators',
      blocks: [{ type: 'bullets', id: 'b-diff', items: [
        { text: 'Woman-owned small business with crews and supervisors based in metro Atlanta and Savannah', claim: 'fact', cites: ['s-upload'] },
        { text: 'Eighteen years of commercial facilities work for hospitals and universities before entering federal work', claim: 'fact', cites: ['s-upload'] },
        { text: 'Same supervisor on every site for the life of the contract', claim: 'fact', cites: ['s-upload'] },
      ] }],
    },
    {
      id: 'sec-data', heading: 'Company Data',
      blocks: [{ type: 'bullets', id: 'b-data', items: [
        { text: 'UEI: RDGLN0000TEST', claim: 'fact', cites: ['s-sam'] },
        { text: 'CAGE: 0TST1', claim: 'fact', cites: ['s-sam'] },
        { text: 'NAICS: 561720 (primary), 561730, 238220', claim: 'fact', cites: ['s-sam'] },
        { text: 'PSC: S201, S208', claim: 'fact', cites: ['s-sam'] },
        { text: 'Socioeconomic: Woman-owned small business (self-certified)', claim: 'fact', cites: ['s-sam'] },
        { text: 'HUBZone: Certified', claim: 'fact' },
      ] }],
    },
    {
      id: 'sec-poc', heading: 'Point of Contact',
      blocks: [{ type: 'bullets', id: 'b-poc', items: [
        { text: 'Name: Jordan Example, President', claim: 'fact', cites: ['s-upload'] },
        { text: 'Phone: (555) 010-0199', claim: 'fact', cites: ['s-upload'] },
        { text: 'Email: jordan@example.com', claim: 'fact', cites: ['s-upload'] },
        { text: 'Website: example.com', claim: 'fact', cites: ['s-upload'] },
      ] }],
    },
    { id: 'sec-about', heading: 'How to read this', role: 'about', blocks: [{ type: 'paragraph', id: 'p-about', claim: 'context', text: 'This statement summarizes the company for federal buyers.' }] },
  ],
};

/**
 * Shaped like the real output Eric flagged (2026-11-27): written WITHOUT kind (the title says "Capability
 * Statement"), on the briefing theme, with the sections the model actually wrote: Company Overview, Core
 * Capabilities, Past Performance carrying a coaching NOTE callout, Differentiators, Leadership, a Company Data
 * FIELD/VALUE table cited as a whole, plain Contact lines, a Sources section and a How to read section. The
 * upload source carries an internal Vault UUID. Synthetic company and identifiers.
 */
export const CAPABILITY_STATEMENT_AS_WRITTEN: DocModel = {
  schema: DOC_SCHEMA,
  theme: 'briefing',
  title: 'Harborline Build LLC Capability Statement',
  subtitle: 'General contracting and facility renovation for federal sites in Hawaii, led by a team with two decades of federal construction work.',
  preparedFor: 'Harborline Build LLC',
  date: '2026-11-27',
  sources: [
    { id: 's1', kind: 'tool', label: 'SAM.gov entity registration: Harborline Build LLC (synthetic)', recordId: 'HRBLN0000TEST' },
    { id: 's2', kind: 'upload', label: 'Harborline-company-profile.docx', recordId: '67e4223f-0000-4000-8000-00000000abcd' },
    { id: 's3', kind: 'usaspending', label: 'USAspending award record (synthetic)', recordId: 'W9128A26C0001' },
  ],
  sections: [
    { id: 'ov', heading: 'Company Overview', blocks: [{ type: 'paragraph', id: 'ov1', claim: 'fact', cites: ['s2'], text: 'Harborline Build is a small general contractor in Honolulu that renovates offices, clinics and housing for public owners.' }] },
    { id: 'cc', heading: 'Core Capabilities', blocks: [{ type: 'bullets', id: 'cc1', items: [
      { text: 'Interior renovation and tenant improvement', claim: 'fact', cites: ['s2'] },
      { text: 'Roofing and envelope repair', claim: 'fact', cites: ['s2'] },
      { text: 'ADA accessibility upgrades', claim: 'fact', cites: ['s2'] },
      { text: 'Construction management and scheduling', claim: 'fact', cites: ['s2'] },
    ] }] },
    { id: 'pp', heading: 'Past Performance', blocks: [
      { type: 'paragraph', id: 'pp1', claim: 'fact', cites: ['s3'], text: 'Related experience: barracks renovation at Schofield Barracks, $1.2M, a Coastline Holdings LLC contract, not a Harborline Build contract.' },
      { type: 'callout', id: 'pp-note', tone: 'note', claim: 'recommendation', text: 'Add your first completed project here before you hand this out.' },
    ] },
    { id: 'df', heading: 'Differentiators', blocks: [{ type: 'bullets', id: 'df1', items: [
      { text: 'Local crews on Oahu, Maui and the Big Island', claim: 'fact', cites: ['s2'] },
      { text: 'Owner on every site visit', claim: 'fact', cites: ['s2'] },
    ] }] },
    { id: 'ld', heading: 'Leadership and Team', blocks: [{ type: 'paragraph', id: 'ld1', claim: 'fact', cites: ['s2'], text: 'Led by a principal with twenty years of federal construction management.' }] },
    { id: 'cd', heading: 'Company Data', blocks: [{ type: 'table', id: 'cd1', claim: 'fact', cites: ['s1'], columns: [{ key: 'f', label: 'Field' }, { key: 'v', label: 'Value' }], rows: [
      { f: 'UEI', v: 'HRBLN0000TEST' }, { f: 'CAGE', v: '0HRB1' }, { f: 'NAICS', v: '236220 (primary), 238160' },
      { f: 'Small business', v: 'Yes, under NAICS 236220' }, { f: 'Registration expires', v: '2027-05-14' },
    ] }] },
    { id: 'ct', heading: 'Contact', blocks: [{ type: 'bullets', id: 'ct1', items: [
      { text: 'Kai Example, Owner', claim: 'fact', cites: ['s2'] },
      { text: '(555) 010-0142', claim: 'fact', cites: ['s2'] },
      { text: 'kai@example.com', claim: 'fact', cites: ['s2'] },
    ] }] },
    { id: 'src', heading: 'Sources', blocks: [{ type: 'paragraph', id: 'src1', claim: 'fact', cites: ['s1', 's2'], text: 'Company data from the SAM.gov registration and the company profile.' }] },
    { id: 'how', heading: 'How to read this', role: 'about', blocks: [{ type: 'paragraph', id: 'how1', claim: 'context', text: 'Facts carry a citation.' }] },
  ],
};
