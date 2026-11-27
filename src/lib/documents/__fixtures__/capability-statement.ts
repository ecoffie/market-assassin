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
