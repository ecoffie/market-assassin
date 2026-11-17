/**
 * 2026-11-17 OSBP contact audit (Data Core PR 2). Pins:
 *  - every previously unverified office carries an audit record against an official page;
 *  - only a mailbox seen on an official page is stamped verified;
 *  - a mailbox absent from a fully read official small-business page is withheld, never served;
 *  - the approved director corrections;
 *  - the internal audit record (and any withheld address) never leaves the directory loader.
 */
import { describe, it, expect } from 'vitest';
import raw from '@/data/dod-command-info.json';
import { getAllCommands, getCommandInfo } from './command-info';
import { lookupFederalOsbp } from '@/mcp/tools/federal-osbp';

type Office = {
  director: string; directorVerified?: string; email: string; emailVerified?: string; contactSourceUrl?: string;
  emailAudit?: { checkedAt: string; status: string; sourceUrl: string; previousEmail?: string; withheldEmail?: string };
};
const commands = (raw as unknown as { commands: Record<string, { smallBusinessOffice: Office }> }).commands;
const offices = Object.entries(commands).map(([k, v]) => [k, v.smallBusinessOffice] as const);
const OFFICIAL = /^https:\/\/([\w-]+\.)*(gov|mil|tva\.com|si\.edu)\//;

describe('OSBP directory audit record', () => {
  it('every office without a verified director carries a dated audit against an official page', () => {
    const unverified = offices.filter(([, o]) => !o.directorVerified || o.emailAudit);
    expect(unverified.length).toBeGreaterThanOrEqual(121);
    for (const [k, o] of offices) {
      if (o.directorVerified && !o.emailAudit) continue;
      expect(o.emailAudit, k).toBeDefined();
      expect(o.emailAudit!.checkedAt, k).toBe('2026-11-17');
      expect(['published', 'different_published', 'not_published', 'no_official_sb_page', 'unreachable'], k).toContain(o.emailAudit!.status);
      expect(o.emailAudit!.sourceUrl, k).toMatch(OFFICIAL);
    }
  });

  it('a mailbox is stamped verified only when seen on an official page, with that page recorded', () => {
    for (const [k, o] of offices) {
      if (!o.emailVerified) continue;
      expect(o.email, k).toBeTruthy();
      expect(o.contactSourceUrl, k).toMatch(OFFICIAL);
      if (o.emailAudit) expect(['published', 'different_published'], k).toContain(o.emailAudit.status);
    }
  });

  it('an unverified mailbox is never stamped, and a withheld one is never served', () => {
    for (const [k, o] of offices) {
      const st = o.emailAudit?.status;
      if (st === 'unreachable' || st === 'no_official_sb_page') expect(o.emailVerified, k).toBeUndefined();
      if (st === 'not_published') {
        expect(o.email, k).toBe('');
        expect(o.emailAudit!.withheldEmail, k).toBeTruthy();
      }
      if (st === 'different_published') expect(o.emailAudit!.previousEmail, k).toBeDefined();
    }
  });

  it('approved corrections: FDIC, HUD, VA, NRC, AFSC', () => {
    expect(commands.FDIC.smallBusinessOffice).toMatchObject({ director: 'Brian Guy', directorVerified: '2026-11' });
    expect(commands.HUD.smallBusinessOffice).toMatchObject({ director: 'Jean Lin Pao', directorVerified: '2026-11' });
    expect(commands.VA.smallBusinessOffice).toMatchObject({ email: 'vetbiz@va.gov', emailVerified: '2026-11' });
    expect(commands.VA.smallBusinessOffice.emailAudit?.previousEmail).toBe('osdbu@va.gov');
    expect(commands.NRC.smallBusinessOffice.director).not.toMatch(/Ordaz/);
    expect(commands.NRC.smallBusinessOffice.directorVerified).toBeUndefined();
    const afsc = commands['Air Force Sustainment Center'].smallBusinessOffice;
    expect(afsc.director).not.toMatch(/Boyd/);
    expect(afsc.directorVerified).toBeUndefined();
  });
});

describe('serving path never exposes the audit record or a withheld address', () => {
  it('the loaded directory carries no emailAudit and no withheld mailbox', () => {
    const served = JSON.stringify(getAllCommands());
    expect(served).not.toContain('emailAudit');
    expect(served).not.toContain('withheldEmail');
    for (const [, o] of offices) {
      const w = o.emailAudit?.withheldEmail;
      if (w) expect(served.toLowerCase()).not.toContain(w.toLowerCase());
    }
    expect(getCommandInfo('FDIC')?.smallBusinessOffice.email).toBe('');
  });

  it('lookup_federal_osbp labels every mailbox: verified, unverified, or none', () => {
    const ice = lookupFederalOsbp({ agency: 'ICE' }).office!;
    expect(ice).toMatchObject({ email_status: 'verified', email_verified: '2026-11' });
    expect(ice.contact_source_url).toMatch(OFFICIAL);

    const indopacom = lookupFederalOsbp({ agency: 'USINDOPACOM' }).office!;
    expect(indopacom.email).toBeTruthy();
    expect(indopacom).toMatchObject({ email_status: 'unverified', email_verified: null });

    const nsa = lookupFederalOsbp({ agency: 'NSA' });
    expect(nsa.office).toMatchObject({ email: null, email_status: 'none' });
    expect(JSON.stringify(nsa)).not.toContain('SmallBusiness@nsa.gov');
  });

  it('_meta reports the verified/unverified mailbox split', () => {
    const r = lookupFederalOsbp({ agency: 'Department of the Navy' });
    expect(r._meta.emails_verified + r._meta.emails_unverified).toBeLessThanOrEqual(r._meta.office_count);
    expect(r._meta.emails_unverified).toBeGreaterThan(0);
  });
});
