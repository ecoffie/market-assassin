import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase/client';
import { sendFreeResourceEmail } from '@/lib/send-email';
import { normalizeAttribution, pushLeadToGhl } from '@/lib/mindy/lead-attribution';

// Free resources that require email capture
export const FREE_RESOURCES = {
  'sblo-list': {
    name: 'SBLO Contact List',
    description: 'Small Business Liaison Officers directory',
    file: '/resources/sblo-contact-list.html',
  },
  'tier2-list': {
    name: 'Tier-2 Supplier List',
    description: 'Tier-2 supplier contacts and vendor registration portals',
    file: '/resources/tier2-supplier-list.html',
  },
  'december-spend': {
    name: 'December Spend Forecast',
    description: 'Year-end government spending predictions',
    file: '/resources/december-spend-forecast.html',
  },
  'ai-prompts': {
    name: '75+ AI Prompts for GovCon',
    description: 'Ready-to-use AI prompts for proposals, BD, marketing, and operations',
    file: '/resources/ai-prompts-govcon.html',
  },
  'action-plan': {
    name: '2026 GovCon Action Plan',
    description: 'Step-by-step roadmap to winning federal contracts in 2026',
    file: '/resources/action-plan-2026.html',
  },
  'guides-templates': {
    name: 'GovCon Guides & Templates',
    description: 'Comprehensive guides and ready-to-use templates',
    file: '/resources/govcon-guides-templates.html',
  },
  'expiring-contracts-csv': {
    name: 'Expiring Contracts CSV',
    description: 'Sample of expiring federal contracts data',
    file: '/resources/expiring-contracts-sample.csv',
  },
  'tribal-list': {
    name: 'Tribal Contractor List',
    description: '500+ Native American-owned federal contractors',
    file: '/resources/tribal-contractor-list.csv',
  },
  'first-contract-guide': {
    name: 'The No-B.S. Guide to Winning Your First Federal Contract',
    description: 'The honest 7-step path to your first federal contract — free, no jargon',
    file: '/resources/first-contract-guide.html',
  },
  'capability-template': {
    name: 'Capability Statement Template',
    description: 'Professional capability statement template',
    file: '/templates/capability-statement-template.html',
  },
  'email-scripts': {
    name: 'SBLO Email Scripts',
    description: 'Ready-to-use outreach email templates',
    file: '/templates/email-scripts-sblo.html',
  },
  'proposal-checklist': {
    name: 'Proposal Response Checklist',
    description: 'Comprehensive proposal compliance checklist',
    file: '/templates/proposal-checklist.html',
  },
  'dsbs-scorer': {
    name: 'DSBS Profile Scorer',
    description: 'Rate and improve your Dynamic Small Business Search profile',
    file: '/dsbs-scorer',
  },
} as const;

export type ResourceId = keyof typeof FREE_RESOURCES;

// Capture email and grant access to resource
export async function POST(request: NextRequest) {
  try {
    const { email, name, company, resourceId, attribution } = await request.json();
    // Prefer attribution in the body; otherwise fall back to the gca_attr cookie
    // that AttributionTracker sets (sent automatically), so every existing caller
    // gets source attribution without changing its client code.
    let attr = normalizeAttribution(attribution);
    if (!attr.utm_source) {
      const cookie = request.cookies.get('gca_attr')?.value;
      if (cookie) {
        try {
          attr = normalizeAttribution(JSON.parse(decodeURIComponent(cookie)));
        } catch {
          /* malformed cookie — leave attr as-is */
        }
      }
    }

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    if (!resourceId || !(resourceId in FREE_RESOURCES)) {
      return NextResponse.json(
        { error: 'Invalid resource ID' },
        { status: 400 }
      );
    }

    const resource = FREE_RESOURCES[resourceId as ResourceId];
    const supabase = getSupabase();

    if (!supabase) {
      // If Supabase not configured, still return the resource
      // (for development/testing)
      return NextResponse.json({
        success: true,
        resource: {
          id: resourceId,
          ...resource,
        },
        message: 'Access granted (database not configured)',
      });
    }

    // Try to insert or update lead
    const { data: existingLead, error: fetchError } = await supabase
      .from('leads')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 = no rows returned (new lead)
      console.error('Error checking lead:', fetchError);
    }

    let isNewResource = false;

    if (existingLead) {
      // Update existing lead with new resource access
      const existingResources = existingLead.resources_accessed || [];
      if (!existingResources.includes(resourceId)) {
        isNewResource = true;
        const { error: updateError } = await supabase
          .from('leads')
          .update({
            resources_accessed: [...existingResources, resourceId],
            name: name || existingLead.name,
            company: company || existingLead.company,
          })
          .eq('email', email.toLowerCase());

        if (updateError) {
          console.error('Error updating lead:', updateError);
        }
      }
    } else {
      // Create new lead
      isNewResource = true;
      const { error: insertError } = await supabase.from('leads').insert({
        email: email.toLowerCase(),
        name: name || null,
        company: company || null,
        source: resourceId,
        resources_accessed: [resourceId],
        utm_source: attr.utm_source || null,
        utm_medium: attr.utm_medium || null,
        utm_campaign: attr.utm_campaign || null,
        utm_content: attr.utm_content || null,
        referrer: attr.referrer || null,
      });

      if (insertError) {
        console.error('Error creating lead:', insertError);
        // Don't fail - still grant access even if DB insert fails
      }
    }

    // Push the captured lead into GHL for nurture (list home = GHL). Non-fatal —
    // a GHL hiccup must never block resource access. Tag with the resource + source
    // so YouTube-driven magnet captures are segmentable in the nurture rails.
    try {
      const { ok } = await pushLeadToGhl({
        email,
        name,
        company,
        attr,
        tags: [`magnet-${resourceId}`],
      });
      if (ok) {
        await supabase.from('leads').update({ synced_to_ghl: true }).eq('email', email.toLowerCase());
      }
    } catch (ghlErr) {
      console.warn('capture-lead GHL push failed (non-fatal):', ghlErr);
    }

    // Send confirmation email for new resource access
    if (isNewResource) {
      try {
        await sendFreeResourceEmail({
          to: email.toLowerCase(),
          name: name || undefined,
          resourceName: resource.name,
          resourceDescription: resource.description,
          downloadUrl: resource.file,
        });
      } catch (emailError) {
        console.error('Error sending free resource email:', emailError);
        // Don't fail the request if email fails
      }
    }

    return NextResponse.json({
      success: true,
      resource: {
        id: resourceId,
        ...resource,
      },
    });
  } catch (error) {
    console.error('Lead capture error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}

// Check if email has access to a resource
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');
    const resourceId = searchParams.get('resourceId');

    if (!email) {
      return NextResponse.json(
        { error: 'Email required' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    if (!supabase) {
      return NextResponse.json({ hasAccess: false });
    }

    const { data: lead, error } = await supabase
      .from('leads')
      .select('resources_accessed')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !lead) {
      return NextResponse.json({ hasAccess: false });
    }

    const accessedResources = lead.resources_accessed || [];

    if (resourceId) {
      return NextResponse.json({
        hasAccess: accessedResources.includes(resourceId),
        resourceId,
      });
    }

    return NextResponse.json({
      hasAccess: true,
      accessedResources,
    });
  } catch (error) {
    console.error('Access check error:', error);
    return NextResponse.json({ hasAccess: false });
  }
}
