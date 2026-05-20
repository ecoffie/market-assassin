/**
 * Admin: Launch Manager Brief
 *
 * Lightweight production brief for the internal launch command center.
 * Keep this route free of repo-wide fs reads so Vercel does not bundle
 * the full workspace into the serverless function.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminPassword } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const domainPolicy = {
  publicSite: 'https://govcongiants.com',
  miPlatform: 'https://mi.govcongiants.com',
  commandCenter: 'https://mi.govcongiants.com/command-center',
  transitionSurfaces: ['.org', 'tools.govcongiants.org', 'shop URLs'],
  rule: 'New public/sales/SEO links go to govcongiants.com. Beta Mindy product/account/app links stay on mi.govcongiants.com until getmindy.ai/app is ready.',
  warnings: [
    {
      label: 'Legacy .org/tool/MI links',
      occurrences: 3,
      note: 'Audit customer-facing links and redirect old surfaces to the right .com or Mindy destination.',
    },
  ],
};

const launches = [
  {
    name: 'MI Free Rollout',
    status: 'active',
    health: 'yellow',
    objective: 'Activate the audience, complete profiles, and identify users showing real intent.',
    blockers: [
      'Profile completion is still the biggest activation gate.',
      'Free users should receive free alerts only when they are not already MI Pro.',
    ],
    changes: [
      'Unified MI access model clarified: Free, Pro, Internal, White-Glove.',
      'Email plus password is the default sign-in model; 2FA is optional.',
    ],
    actions: [
      {
        owner: 'Annelle/Sikander',
        area: 'outreach',
        action: 'Work the setup and profile-nudge queue before broad selling.',
        dueDate: 'This week',
      },
      {
        owner: 'Tavin',
        area: 'coach',
        action: 'Turn profile completion into a customer-success save instead of a support ticket.',
        dueDate: 'This week',
      },
    ],
  },
  {
    name: 'MI Pro Launch',
    status: 'active',
    health: 'yellow',
    objective: 'Convert serious users into weekly MI intelligence workflows.',
    blockers: [
      'Forecasts, recompetes, contractors, pipeline, and teaming need live-data alignment before launch claims get stronger.',
      'Briefing dates/types must be unambiguous so daily, weekly, and pursuit views do not look duplicated.',
    ],
    changes: [
      'MI Pro positioned as the paid intelligence layer, not another training product.',
      'Pro users should not receive redundant free alerts.',
    ],
    actions: [
      {
        owner: 'Product/Engineering',
        area: 'product',
        action: 'Classify and harden API routes, starting with exposed customer/data endpoints.',
        dueDate: 'This sprint',
      },
      {
        owner: 'Branden',
        area: 'sales',
        action: 'Use Pro usage signals to frame package and enterprise conversations.',
        dueDate: 'This week',
      },
    ],
  },
  {
    name: 'May 30 Bootcamp',
    status: 'planning',
    health: 'yellow',
    objective: 'Demonstrate MI and qualify serious buyers for Pro, team, bundle, or white-glove paths.',
    blockers: [
      'Offer path needs to stay focused on outcomes: find contracts, win contracts, graduate into execution support.',
    ],
    changes: [
      'Bootcamp reframed from training event to platform demo plus committed-client pathway.',
    ],
    actions: [
      {
        owner: 'Eric',
        area: 'founder',
        action: 'Lock the bootcamp story around the company pivot from training to SaaS plus services.',
        dueDate: 'This week',
      },
      {
        owner: 'Kash/Usama/Muneeba',
        area: 'content',
        action: 'Turn the pivot into YouTube, Instagram, and LinkedIn launch assets.',
        dueDate: 'This week',
      },
    ],
  },
  {
    name: 'White-Glove Offer',
    status: 'planning',
    health: 'yellow',
    objective: 'Move committed customers into execution support when they need help pursuing and winning.',
    blockers: [
      'Scope, price bands, capacity, and handoff rules need one memo before selling hard.',
    ],
    changes: [
      'White-glove is now the high-commitment tier for customers who want outcomes, not more lessons.',
    ],
    actions: [
      {
        owner: 'Eric/Branden',
        area: 'sales',
        action: 'Define the first 5-10 white-glove slots, qualification rules, and escalation script.',
        dueDate: 'This week',
      },
    ],
  },
  {
    name: 'Contractor SEO Pages',
    status: 'planning',
    health: 'yellow',
    objective: 'Attract Google users with public contractor sales history and gate deeper MI workflows.',
    blockers: [
      'Public contractor pages need canonical .com URLs while app workflows stay on MI.',
      'Sales history needs public teaser data and gated full access.',
    ],
    changes: [
      'PRD updated to frame contractor sales charts as SEO acquisition plus MI research value.',
    ],
    actions: [
      {
        owner: 'Product/Engineering',
        area: 'product',
        action: 'Build public contractor sales history pages on govcongiants.com with MI upgrade paths.',
        dueDate: 'This sprint',
      },
    ],
  },
  {
    name: 'Deal Flow Board',
    status: 'planning',
    health: 'yellow',
    objective: 'Give groups and teams a shared board for opportunities, pursuits, partners, and next actions.',
    blockers: [
      'Needs PRD scope and permission model before implementation.',
    ],
    changes: [
      'Top buyer feedback identified Deal Flow Board as one of the highest-value future features.',
    ],
    actions: [
      {
        owner: 'Product/Engineering',
        area: 'product',
        action: 'Draft Deal Flow Board V1 around team pursuit coordination and shared next actions.',
        dueDate: 'Next sprint',
      },
    ],
  },
  {
    name: 'Internal Launch Command Center',
    status: 'active',
    health: 'green',
    objective: 'Give the team one private operating link for launch state, owners, queues, and decisions.',
    blockers: [],
    changes: [
      'Command center now includes live MI Growth Brief and Launch Manager Brief sections.',
    ],
    actions: [
      {
        owner: 'Product/Engineering',
        area: 'product',
        action: 'Wire owner-updated launch action data so the dashboard becomes the single source of truth.',
        dueDate: 'This sprint',
      },
    ],
  },
];

const ownerActions = launches.flatMap(launch =>
  launch.actions.map(action => ({
    ...action,
    why: `${launch.name}: ${launch.objective}`,
    source: 'Launch Manager Brief',
  }))
);

const decisions = [
  {
    owner: 'Eric',
    decisionNeeded: 'Which old .org and tools links need immediate redirects versus gradual cleanup?',
    whyItMatters: 'Broken or confusing links cost launch momentum and customer trust.',
    dueDate: 'This week',
  },
  {
    owner: 'Eric/Branden',
    decisionNeeded: 'What are the white-glove price bands, capacity limits, and qualification rules?',
    whyItMatters: 'The team needs one offer path when serious customers raise their hand.',
    dueDate: 'This week',
  },
  {
    owner: 'Product/Engineering',
    decisionNeeded: 'Which 67 candidate routes are public, internal, paid, webhook, or cron?',
    whyItMatters: 'API hardening needs classification before blanket auth changes can ship safely.',
    dueDate: 'This sprint',
  },
];

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(
    {
      success: true,
      generatedAt: new Date().toISOString(),
      domainPolicy,
      launches,
      ownerActions,
      decisions,
      freshness: {
        sources: [
          {
            label: 'launch-manager-brief',
            path: 'src/app/api/admin/launch-manager-brief/route.ts',
            status: 'loaded',
            modifiedAt: new Date().toISOString(),
          },
        ],
      },
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
