import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase/client';

// Free resources that require email capture
export const FREE_RESOURCES = {
  'sblo-list': {
    name: 'SBLO Contact List',
    description: 'Small Business Liaison Officers directory',
    file: '/resources/sblo-contact-list.pdf',
  },
  'december-spend': {
    name: 'December Spend Forecast',
    description: 'Year-end government spending predictions',
    file: '/resources/december-spend-forecast.pdf',
  },
  'capability-template': {
    name: 'Capability Statement Template',
    description: 'Professional capability statement template',
    file: '/templates/capability-statement-template.pdf',
  },
  'email-scripts': {
    name: 'SBLO Email Scripts',
    description: 'Ready-to-use outreach email templates',
    file: '/templates/email-scripts-sblo.pdf',
  },
  'proposal-checklist': {
    name: 'Proposal Response Checklist',
    description: 'Comprehensive proposal compliance checklist',
    file: '/templates/proposal-checklist.pdf',
  },
} as const;

export type ResourceId = keyof typeof FREE_RESOURCES;

// Capture email and grant access to resource
export async function POST(request: NextRequest) {
  try {
    const { email, name, company, resourceId } = await request.json();

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

    if (existingLead) {
      // Update existing lead with new resource access
      const existingResources = existingLead.resources_accessed || [];
      if (!existingResources.includes(resourceId)) {
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
      const { error: insertError } = await supabase.from('leads').insert({
        email: email.toLowerCase(),
        name: name || null,
        company: company || null,
        source: resourceId,
        resources_accessed: [resourceId],
      });

      if (insertError) {
        console.error('Error creating lead:', insertError);
        // Don't fail - still grant access even if DB insert fails
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
