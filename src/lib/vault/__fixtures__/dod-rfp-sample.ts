/**
 * FALSE-POSITIVE CONTROL for the marking detector: the text of an ordinary, UNMARKED DoD
 * solicitation, of the kind users attach in Ask Mindy. It mentions CUI, SECRET clearances,
 * "Controlled by", a CONTROLLED UNCLASSIFIED INFORMATION section heading, DFARS clauses,
 * outline letters (A)(B)(C)(S), URLs with doubled slashes, and proposal-marking
 * instructions ("COMPANY CONFIDENTIAL//PROPRIETARY") — and carries NO banner or portion
 * marking. It must never be refused.
 *
 * Synthetic text written for the test; not a real solicitation.
 */
export const DOD_RFP_SAMPLE = `
SOLICITATION, OFFER AND AWARD
1. CONTRACT NUMBER    2. SOLICITATION NUMBER W912PL-27-R-0001    3. TYPE OF SOLICITATION: NEGOTIATED (RFP)
Page 1 of 64
ISSUED BY: U.S. ARMY CORPS OF ENGINEERS, LOS ANGELES DISTRICT
Controlled by: the Contracting Officer, who is the only person authorized to change this solicitation.

SECTION C — PERFORMANCE WORK STATEMENT
C.1 GENERAL. The Contractor shall provide facilities maintenance services at Fort MacArthur.
C.2 SECURITY REQUIREMENTS.
(A) Personnel performing on-site work shall hold an active SECRET clearance at the time of award.
(B) The Contractor shall obtain a Top Secret facility clearance (FCL) within 180 days.
(C) Key personnel shall complete annual security awareness training.
(S) Small business participation is addressed in Section L.

CONTROLLED UNCLASSIFIED INFORMATION
C.3 The Contractor shall safeguard Controlled Unclassified Information (CUI) in accordance with DFARS 252.204-7012, Safeguarding Covered Defense Information and Cyber Incident Reporting, and NIST SP 800-171. CUI received under this contract shall be marked and handled per DoDI 5200.48. The Contractor shall report cyber incidents at https://dibnet.dod.mil within 72 hours.
C.4 Information about the CUI program is available at HTTPS://WWW.ARCHIVES.GOV//CUI and HTTPS://WWW.SAM.GOV//SI/OPPORTUNITIES.

SECTION H — SPECIAL CONTRACT REQUIREMENTS
H.1 DD Form 254, DoD Contract Security Classification Specification, applies at the SECRET level.
H.2 The Secretary of the Army may terminate for convenience.

SECTION L — INSTRUCTIONS TO OFFERORS
L.1 Offerors shall mark each page of the proposal "COMPANY CONFIDENTIAL//PROPRIETARY" or "TRADE SECRET//PROPRIETARY" as appropriate under FAR 52.215-1(e).
L.2 Volume I, Technical: 30 pages. Volume II, Past Performance: 10 pages. Volume III, Price.
L.3 Questions shall be submitted to the Contract Specialist at least 10 days before the closing date.

SECTION M — EVALUATION FACTORS FOR AWARD
M.1 Award will be made on a best-value tradeoff basis. Technical approach is more important than past performance, which is more important than price.
Page 64 of 64
`;
