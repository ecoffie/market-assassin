import { describe, expect, it } from 'vitest';
import type { DocModel } from '@/lib/documents/model';
import { DOC_SCHEMA } from '@/lib/documents/model';
import {
  fmpDefenseBuyersAppear,
  replaceEmDashes,
  validateFmpWriteup,
  validateFmpWriteupMarkdown,
} from './fmp-writeup-validate';
import { RBA_FEDERAL_MARKET_PROFILE_PROMPT } from './__fixtures__/rba-federal-market-profile';

function baseModel(over: Partial<DocModel> = {}): DocModel {
  return {
    schema: DOC_SCHEMA,
    title: 'RBA Engineering International Federal Market Profile',
    date: '2026-11-20',
    sources: [{ id: 's1', label: 'USAspending', kind: 'usaspending' }],
    sections: [],
    ...over,
  };
}

function goodSections(opts: { pae?: boolean } = {}) {
  const sections = [
    {
      id: 'sec-path',
      heading: 'Six pathways, in priority order',
      blocks: [{
        type: 'paragraph' as const,
        id: 'p1',
        text: 'Lead with the Inspection MATOC vehicle, then sources sought, then direct 8(a) awards. Market size is $470M across VA/MD/DC.',
        claim: 'fact' as const,
        cites: ['s1'],
      }],
    },
    ...(opts.pae !== false
      ? [{
        id: 'sec-pae',
        heading: 'Who owns defense construction now: the PAE shift',
        blocks: [{
          type: 'paragraph' as const,
          id: 'p-pae',
          text: 'PAE now oversees several Navy construction buying offices.',
          claim: 'fact' as const,
          cites: ['s1'],
        }],
      }]
      : []),
    {
      id: 'sec-pain',
      heading: 'What buyers are under pressure to fix',
      blocks: [{
        type: 'paragraph' as const,
        id: 'p-pain',
        text: 'Deferred maintenance and highway timelines.',
        claim: 'fact' as const,
        cites: ['s1'],
      }],
    },
    {
      id: 'sec-who',
      heading: 'Who to talk to and what to say',
      blocks: [{
        type: 'table' as const,
        id: 't-who',
        columns: [
          { key: 'contact', label: 'Contact' },
          { key: 'question', label: 'Question to ask' },
        ],
        rows: [{ contact: 'Helson Roman', question: 'Ask about Inspection MATOC small-business seats.' }],
      }],
    },
    {
      id: 'sec-ready',
      heading: 'Readiness checklist',
      blocks: [{
        type: 'bullets' as const,
        id: 'b-ready',
        ordered: false,
        items: [
          { text: 'Update DSBS keywords for heavy civil and bridge.', claim: 'recommendation' as const },
        ],
      }],
    },
  ];
  return sections;
}

describe('fmp-writeup-validate', () => {
  it('detects defense buyers on the RBA cold prompt', () => {
    expect(fmpDefenseBuyersAppear(RBA_FEDERAL_MARKET_PROFILE_PROMPT)).toBe(true);
    expect(fmpDefenseBuyersAppear('Build a federal market profile for an IT staffing firm in Texas')).toBe(false);
  });

  it('soft-replaces em dashes', () => {
    expect(replaceEmDashes('A — B – C')).toBe('A - B - C');
  });

  it('passes a minimal valid DocModel (market $ allowed; Mid CTA absent)', () => {
    const r = validateFmpWriteup(baseModel({ sections: goodSections() }), { defenseBuyersAppear: true });
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('fails pathways-first when first substantive section is market size', () => {
    const sections = [
      { id: 'exec', heading: 'Executive summary', blocks: [{ type: 'paragraph' as const, id: 'e', text: 'Overview.', claim: 'context' as const }] },
      { id: 'money', heading: 'Where the money sits', blocks: [{ type: 'paragraph' as const, id: 'm', text: '$42.5M.', claim: 'fact' as const, cites: ['s1'] }] },
      ...goodSections().slice(1),
    ];
    const r = validateFmpWriteup(baseModel({ sections }), { defenseBuyersAppear: true });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'pathways_first')).toBe(true);
  });

  it('fails without who-to-talk-to table/heading', () => {
    const sections = goodSections().filter((s) => s.id !== 'sec-who');
    const r = validateFmpWriteup(baseModel({ sections }), { defenseBuyersAppear: true });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'who_to_talk')).toBe(true);
  });

  it('fails without DSBS in checklist', () => {
    const sections = goodSections().map((s) => {
      if (s.id !== 'sec-ready') return s;
      return {
        ...s,
        blocks: [{
          type: 'bullets' as const,
          id: 'b-ready',
          ordered: false,
          items: [{ text: 'Bring bonding letter.', claim: 'recommendation' as const }],
        }],
      };
    });
    const r = validateFmpWriteup(baseModel({ sections }), { defenseBuyersAppear: true });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'dsbs')).toBe(true);
  });

  it('requires PAE only when defenseBuyersAppear', () => {
    const sections = goodSections({ pae: false });
    expect(validateFmpWriteup(baseModel({ sections }), { defenseBuyersAppear: true }).ok).toBe(false);
    expect(validateFmpWriteup(baseModel({ sections }), { defenseBuyersAppear: false }).ok).toBe(true);
  });

  it('bans Mid plan CTA but allows $470M market figures', () => {
    const ok$ = validateFmpWriteup(baseModel({ sections: goodSections() }), { defenseBuyersAppear: true });
    expect(ok$.ok).toBe(true);

    const sections = goodSections().map((s) => {
      if (s.id !== 'sec-path') return s;
      return {
        ...s,
        blocks: [{
          type: 'paragraph' as const,
          id: 'p1',
          text: 'Upgrade to Mid plan ($5–10K) for coaching.',
          claim: 'recommendation' as const,
        }],
      };
    });
    const bad = validateFmpWriteup(baseModel({ sections }), { defenseBuyersAppear: true });
    expect(bad.ok).toBe(false);
    expect(bad.issues.some((i) => i.code === 'mid_cta_ban')).toBe(true);
  });

  it('bans narrow grading phrases; soft-warns open-bid frame without refusing', () => {
    const graded = goodSections().map((s) => {
      if (s.id !== 'sec-path') return s;
      return {
        ...s,
        blocks: [{
          type: 'paragraph' as const,
          id: 'p1',
          text: 'We grade the firm overall grade A+.',
          claim: 'recommendation' as const,
        }],
      };
    });
    const g = validateFmpWriteup(baseModel({ sections: graded }), { defenseBuyersAppear: true });
    expect(g.ok).toBe(false);
    expect(g.issues.some((i) => i.code === 'grading_ban')).toBe(true);

    const openBid = goodSections().map((s) => {
      if (s.id !== 'sec-path') return s;
      return {
        ...s,
        blocks: [{
          type: 'paragraph' as const,
          id: 'p1',
          text: 'Pathways first. Also see current open RFPs nearby.',
          claim: 'fact' as const,
          cites: ['s1'],
        }],
      };
    });
    const o = validateFmpWriteup(baseModel({ sections: openBid }), { defenseBuyersAppear: true });
    expect(o.ok).toBe(true);
    expect(o.issues.some((i) => i.code === 'open_bid_frame' && i.severity === 'warn')).toBe(true);
  });

  it('soft-replaces em dashes so punctuation alone does not refuse', () => {
    const sections = goodSections().map((s) => {
      if (s.id !== 'sec-pain') return s;
      return {
        ...s,
        blocks: [{
          type: 'paragraph' as const,
          id: 'p-pain',
          text: 'Buyers face deferred maintenance — and highway pressure.',
          claim: 'fact' as const,
          cites: ['s1'],
        }],
      };
    });
    const r = validateFmpWriteup(baseModel({ sections }), { defenseBuyersAppear: true });
    expect(r.ok).toBe(true);
    expect(r.model && JSON.stringify(r.model)).not.toMatch(/[—–]/);
  });

  it('hard-fails Performance Assessment Evaluation PAE gloss', () => {
    const sections = goodSections().map((s) => {
      if (s.id !== 'sec-pae') return s;
      return {
        ...s,
        blocks: [{
          type: 'paragraph' as const,
          id: 'p-pae',
          text: 'PAE here means Performance Assessment Evaluation.',
          claim: 'fact' as const,
          cites: ['s1'],
        }],
      };
    });
    const r = validateFmpWriteup(baseModel({ sections }), { defenseBuyersAppear: true });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'pae_gloss_ban')).toBe(true);
  });

  it('hard-fails when requiredSnippets are missing; passes when present', () => {
    const missing = validateFmpWriteup(baseModel({ sections: goodSections() }), {
      defenseBuyersAppear: true,
      requiredSnippets: ['237310', '$42.5M'],
    });
    expect(missing.ok).toBe(false);
    expect(missing.issues.some((i) => i.code === 'required_snippet')).toBe(true);

    const sections = goodSections().map((s) => {
      if (s.id !== 'sec-path') return s;
      return {
        ...s,
        blocks: [{
          type: 'paragraph' as const,
          id: 'p1',
          text: 'Lead with MATOC. Primary NAICS 237310 at $42.5M obligations.',
          claim: 'fact' as const,
          cites: ['s1'],
        }],
      };
    });
    const ok = validateFmpWriteup(baseModel({ sections }), {
      defenseBuyersAppear: true,
      requiredSnippets: ['237310', '$42.5M'],
    });
    expect(ok.ok).toBe(true);
  });

  it('markdown fallback enforces the same hard bans', () => {
    const good = [
      '# Pathways in priority order',
      'Vehicles and sources sought.',
      '## What buyers are under pressure to fix',
      'Pain.',
      '## Who to talk to and what to say',
      'Ask Helson Roman about seats.',
      '## Readiness checklist',
      'DSBS keywords: bridge, marine.',
      '## PAE / defense oversight',
      'PAE shift.',
    ].join('\n');
    expect(validateFmpWriteupMarkdown(good, { defenseBuyersAppear: true }).ok).toBe(true);
    expect(validateFmpWriteupMarkdown(good + '\nMid plan ($5K-$10K)', { defenseBuyersAppear: true }).ok).toBe(false);
  });
});
