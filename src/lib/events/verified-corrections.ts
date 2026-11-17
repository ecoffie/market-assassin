/**
 * Event rows corrected by hand from the source notice, with Eric's approval (2026-11-09).
 *
 * The refresh (R2–R4) re-derives every upcoming event from its notice. Without this list its first
 * run would undo three of these corrections: SIMO (the extractor reads "rfi 2026-12-07") and the two
 * older GOCO notices (blank solicitation number, so the family rule cannot link them to the notice
 * that moved the date to Nov 18; on their own they still say Nov 17).
 *
 * A protected row is never changed by a category batch. A proposed value that differs is reported as
 * UNCERTAIN; it is written only when its notice id is listed explicitly in
 * SAM_EVENTS_REFRESH_NOTICES (a reviewed, per-record decision). The report marks it `superseded`
 * when newer authoritative evidence exists: a notice in the same CONFIRMED solicitation family,
 * posted after `verified_on`, that states this event type with a different date.
 *
 * Both fields are protected: each row was reviewed against its notice as a whole.
 */
export interface VerifiedCorrection {
  notice_id: string;
  event_type: string;
  event_date: string | null;
  /** UTC date the correction was verified and written. */
  verified_on: string;
  evidence: string;
}

const ON = '2026-11-09';
const d = (notice_id: string, event_date: string | null, evidence: string, event_type = 'industry_day'): VerifiedCorrection =>
  ({ notice_id, event_type, event_date, verified_on: ON, evidence });

export const VERIFIED_CORRECTIONS: readonly VerifiedCorrection[] = [
  // Dates verified against the notice text (milestone/deadline dates had been taken as the event)
  d('b44026882ad144629634ab6643a9f0d8', '2026-12-02', 'DLA-RFI-CT-2027-WBOS-MKTRES'),
  d('b7970fad82864fada92c334ab901d2b0', '2026-12-08', 'DDLS FY 2027 Industry Day'),
  d('54e3481c724f4144a5e7591a9bafa503', '2026-12-08', 'DOW Maintenance Symposium Industry Day'),
  d('67928d9b69574f4cbd82b5c7b1f8b740', '2026-11-16', 'DOWEA Preventative Maintenance industry day'),
  d('ac45b77cb345463bbac059f25478baa2', '2026-12-08', 'F-15EX 8-Bay Maintenance Hangar Complex Industry Day'),
  d('eebb34e572a04b4fae737951804c1ba3', '2026-12-02', 'Industry Day - Tactical Protective Equipment'),
  d('b832f24214a64fd2869a1e9f741d1989', '2027-02-09', 'NAWCWD California Contracting/Acquisition/Procurement'),
  d('6e23f27926064b3c826e9ba72998fcde', '2026-12-08', 'PAE(A) Autonomy & SI / AI industry day'),
  d('5c931ea0c2144f21ac6875c9a16331e4', '2026-12-08', 'PAE(A) Autonomy & SI / AI industry day'),
  d('3d691843060747d081995a0063f5edb1', '2026-12-07', 'Royal Saudi Land Forces CH-47F/UH-60M'),
  d('178d0b003dfc436b92711d699cd9165f', '2026-12-01', 'SBU-E Radio Army industry day'),
  d('822a7aba509c4f559c382b78df4dac6f', '2026-12-07', 'St. Lucie South Jetty Repair Industry Day'),
  d('83773451369840cf8f271d873b8cf7bd', '2026-12-07', 'St. Lucie South Jetty Repair Industry Day'),
  d('20aace37794340d5924c271280066784', '2027-02-02', 'U.S. AFRICOM Industry Day - Tunis (2-4 Feb)'),
  d('da74fba251794157a586b821fd45573e', '2026-12-10', 'VA Air Ambulance Broker'),
  d('2616e11e72fd4124a25fa09c8fb265d8', '2026-11-18', 'GOCO Industry Day (newer notice, states Nov 18)'),
  d('108d00771d744e7e96dc160378fd0967', '2026-11-18', 'GOCO Industry Day (newest notice, states Nov 18)'),
  // SOCOM H92400 AE Small Business Forum: type forecast → industry_day (#1951)
  d('9bb7c179cdaf483a97eb0b8803974387', '2026-11-10', 'SOCOM AE Small Business Forum — type corrected from forecast'),
  // SIMO: the only date in the notice is the RFP release milestone, so the event date is unknown
  d('fff15eda49e84966ac21f547b34e2afe', null, 'SIMO — 2026-12-07 is a milestone, not an event date'),
  // GOCO older notices: no solicitation number; the later GOCO notices moved the date to Nov 18
  d('0a11491ad132434dbd30e7268c2fcb5c', '2026-11-18', 'GOCO older notice — date moved to Nov 18 by later notices (no sol # to link)'),
  d('447081bac39c4b89ada28ea770794510', '2026-11-18', 'GOCO older notice — date moved to Nov 18 by later notices (no sol # to link)'),
  // TSA25-04-0644 original: Amendment 1 (a new notice) moved the industry day to Nov 18
  d('f98693bbb744490cb7920e8b2651c1d7', '2026-11-18', 'TSA Domestic Aviation Design — Amendment 1 moved Nov 17 → Nov 18'),
];

export const VERIFIED_BY_NOTICE: ReadonlyMap<string, VerifiedCorrection> = new Map(VERIFIED_CORRECTIONS.map((c) => [c.notice_id, c]));
