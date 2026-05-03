/**
 * Contacts API
 * GET /api/contacts?email=user@example.com - List contacts
 * GET /api/contacts?email=user@example.com&search=query - Search contacts
 * POST /api/contacts - Create contact
 * PATCH /api/contacts - Update contact
 * DELETE /api/contacts?id=xxx&email=user@example.com - Delete contact
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
  searchContacts,
} from '@/lib/unified-platform';

// GET - List or search contacts
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');
    const id = searchParams.get('id');
    const search = searchParams.get('search');

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    // Get single contact by ID
    if (id) {
      const contact = await getContact(id, email);
      if (!contact) {
        return NextResponse.json(
          { success: false, error: 'Contact not found' },
          { status: 404 }
        );
      }
      return NextResponse.json({ success: true, contact });
    }

    // Search contacts
    if (search) {
      const contacts = await searchContacts(email, search);
      return NextResponse.json({ success: true, contacts, count: contacts.length });
    }

    // List all contacts
    const contacts = await getContacts(email);
    return NextResponse.json({ success: true, contacts, count: contacts.length });
  } catch (error) {
    console.error('GET /api/contacts error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// POST - Create contact
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.user_email || !body.name) {
      return NextResponse.json(
        { success: false, error: 'user_email and name are required' },
        { status: 400 }
      );
    }

    const contact = await createContact({
      user_email: body.user_email,
      name: body.name,
      email: body.email,
      phone: body.phone,
      company: body.company,
      title: body.title,
      agency: body.agency,
      notes: body.notes,
      tags: body.tags,
      source: body.source,
    });

    return NextResponse.json({ success: true, contact }, { status: 201 });
  } catch (error) {
    console.error('POST /api/contacts error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// PATCH - Update contact
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.id || !body.user_email) {
      return NextResponse.json(
        { success: false, error: 'id and user_email are required' },
        { status: 400 }
      );
    }

    const contact = await updateContact(body.id, body.user_email, {
      name: body.name,
      email: body.email,
      phone: body.phone,
      company: body.company,
      title: body.title,
      agency: body.agency,
      notes: body.notes,
      tags: body.tags,
    });

    return NextResponse.json({ success: true, contact });
  } catch (error) {
    console.error('PATCH /api/contacts error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// DELETE - Delete contact
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const email = searchParams.get('email');

    if (!id || !email) {
      return NextResponse.json(
        { success: false, error: 'id and email are required' },
        { status: 400 }
      );
    }

    await deleteContact(id, email);
    return NextResponse.json({ success: true, message: 'Contact deleted' });
  } catch (error) {
    console.error('DELETE /api/contacts error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
