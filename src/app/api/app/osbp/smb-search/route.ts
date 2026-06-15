/**
 * /api/app/osbp/smb-search?email=&naics=&state=&certs=8a,SDVOSB,WOSB,HUBZone&limit=
 *
 * Navy OSBP "SMB market research": find small/minority businesses by NAICS +
 * socioeconomic certification + state, from the authoritative SAM entity registry
 * (the BQ recipients table has no cert fields). Returns a clean, exportable list.
 *
 * If multiple certs are passed, we union the results (a firm matching ANY of the
 * selected certs). No cert = all active registered entities in that NAICS/state.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { searchByCertification, findTeamingPartners, type SAMEntity } from '@/lib/sam/entity-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Cert = '8a' | 'SDVOSB' | 'WOSB' | 'HUBZone';
const VALID_CERTS: Cert[] = ['8a', 'SDVOSB', 'WOSB', 'HUBZone'];
// SAM v3 entity search hard-filters only SBA-CERTIFIED types (8a, HUBZone) via
// sbaBusinessTypeCode. SDVOSB & WOSB are self-certified in a different field and
// return 0 when filtered that way — so for those we search NAICS/state and
// post-filter on the entity's computed cert flags. (Verified live 2026-06-14.)
const HARD_FILTERABLE: Cert[] = ['8a', 'HUBZone'];
// SAM v3 caps page size at 10 (size>10 → HTTP 400). Hard cap here.
const SAM_MAX = 10;
const FLAG: Record<Cert, keyof import('@/lib/sam/entity-api').SAMEntity> = {
  '8a': 'has8a', SDVOSB: 'hasSDVOSB', WOSB: 'hasWOSB', HUBZone: 'hasHUBZone',
};

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const email = sp.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const naics = (sp.get('naics') || '').split(/[, ]+/)[0]?.trim() || undefined;
  const state = (sp.get('state') || '').trim().toUpperCase() || undefined;
  const limit = SAM_MAX; // SAM v3 caps entity-search page size at 10
  const certs = (sp.get('certs') || '')
    .split(',').map(c => c.trim()).filter((c): c is Cert => VALID_CERTS.includes(c as Cert));

  if (!naics && !state && certs.length === 0) {
    return NextResponse.json({ success: false, error: 'Provide at least a NAICS code, state, or certification to search.' }, { status: 400 });
  }

  try {
    const byUei = new Map<string, SAMEntity>();
    const notes: string[] = [];

    if (certs.length > 0) {
      const hard = certs.filter(c => HARD_FILTERABLE.includes(c));
      const soft = certs.filter(c => !HARD_FILTERABLE.includes(c)); // SDVOSB / WOSB

      // 8(a) & HUBZone: hard-filter at SAM (authoritative, reliable).
      const hardResults = await Promise.all(
        hard.map(c => searchByCertification(c, { naicsCode: naics, stateCode: state, limit }).catch(() => [] as SAMEntity[]))
      );
      for (const list of hardResults) for (const e of list) if (e.ueiSAM) byUei.set(e.ueiSAM, e);

      // SDVOSB / WOSB: SAM can't hard-filter these (self-certified, different
      // field). Pull NAICS/state set + keep those whose entity flags self-report.
      if (soft.length) {
        const base = await findTeamingPartners(naics || '', undefined, state, limit).catch(() => [] as SAMEntity[]);
        const matched = base.filter(e => soft.some(c => e[FLAG[c]]));
        for (const e of matched) if (e.ueiSAM) byUei.set(e.ueiSAM, e);
        notes.push(`${soft.join(' & ')} are self-certified in SAM and can't be hard-filtered — these are matches found within NAICS/state results (may be partial). 8(a) & HUBZone are exact.`);
      }
    } else {
      const base = await findTeamingPartners(naics || '', undefined, state, limit);
      for (const e of base) if (e.ueiSAM) byUei.set(e.ueiSAM, e);
    }

    const entities = [...byUei.values()];
    const rows = entities.slice(0, limit).map(e => {
      const certList = [
        e.has8a && '8(a)',
        e.hasSDVOSB && 'SDVOSB',
        e.hasWOSB && 'WOSB',
        e.hasHUBZone && 'HUBZone',
      ].filter(Boolean) as string[];
      const poc = (e.pointsOfContact || []).find(p => p.email) || (e.pointsOfContact || [])[0];
      return {
        uei: e.ueiSAM,
        cage: e.cageCode || '',
        name: e.legalBusinessName,
        dba: e.dbaName || '',
        city: e.physicalAddress?.city || '',
        state: e.physicalAddress?.stateOrProvince || '',
        certs: certList,
        primaryNaics: (e.naicsList || []).find(n => n.isPrimary)?.naicsCode || (e.naicsList || [])[0]?.naicsCode || '',
        registrationStatus: e.registrationStatus,
        contactName: poc?.name || '',
        contactEmail: poc?.email || '',
        contactPhone: poc?.phone || '',
      };
    });

    return NextResponse.json({
      success: true,
      query: { naics: naics || null, state: state || null, certs },
      count: rows.length,
      samCapped: rows.length >= SAM_MAX, // SAM v3 returns at most 10 per query
      notes,
      results: rows,
    });
  } catch (err) {
    console.error('[osbp/smb-search]', err);
    return NextResponse.json({ success: false, error: 'SAM entity search failed', results: [] }, { status: 500 });
  }
}
