import { kv } from '@vercel/kv';
import nodemailer from 'nodemailer';
import { hasBriefingsAccess } from '@/lib/briefings/access';

export type AccessDestination = 'briefings' | 'preferences';

interface AccessLinkPayload {
  email: string;
  destination: AccessDestination;
  createdAt: string;
}

const ACCESS_LINK_PREFIX = 'access-link';
const ACCESS_LINK_TTL_SECONDS = 60 * 15;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function buildAccessUrl(token: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL || 'https://tools.govcongiants.org'}/access?token=${encodeURIComponent(token)}`;
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.office365.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || 'alerts@govcongiants.com',
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

export async function validateAccessRequest(email: string, destination: AccessDestination): Promise<{ ok: boolean; error?: string }> {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return { ok: false, error: 'Email is required' };
  }

  if (destination === 'briefings') {
    const hasAccess = await hasBriefingsAccess(normalizedEmail);
    if (!hasAccess) {
      return { ok: false, error: 'No Market Intelligence access found for this email yet.' };
    }
  }

  return { ok: true };
}

export async function createAccessLink(email: string, destination: AccessDestination): Promise<string> {
  const normalizedEmail = normalizeEmail(email);
  const token = crypto.randomUUID();
  const payload: AccessLinkPayload = {
    email: normalizedEmail,
    destination,
    createdAt: new Date().toISOString(),
  };

  await kv.set(`${ACCESS_LINK_PREFIX}:${token}`, payload, { ex: ACCESS_LINK_TTL_SECONDS });
  return token;
}

export async function createSecureAccessUrl(email: string, destination: AccessDestination): Promise<string> {
  const token = await createAccessLink(email, destination);
  return buildAccessUrl(token);
}

export async function consumeAccessLink(token: string): Promise<AccessLinkPayload | null> {
  if (!token) return null;

  const key = `${ACCESS_LINK_PREFIX}:${token}`;
  const payload = await kv.get<AccessLinkPayload>(key);
  if (!payload) return null;

  await kv.del(key);
  return payload;
}

export async function sendAccessLinkEmail(email: string, destination: AccessDestination): Promise<void> {
  const accessUrl = await createSecureAccessUrl(email, destination);
  const destinationLabel = destination === 'briefings' ? 'Market Intelligence' : 'Email Preferences';
  const actionLabel = destination === 'briefings' ? 'Open Market Intelligence' : 'Manage Preferences';

  await getTransporter().sendMail({
    from: `"GovCon Giants AI" <${process.env.SMTP_USER || 'hello@govconedu.com'}>`,
    to: normalizeEmail(email),
    subject: `${destinationLabel} secure access link | GovCon Giants`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #0f172a;">
        <div style="background: linear-gradient(135deg, #1e293b, #0f172a); border-radius: 16px; padding: 28px; color: white;">
          <div style="font-size: 28px; font-weight: 700; margin-bottom: 8px;">GovCon Giants</div>
          <div style="font-size: 16px; color: #cbd5e1;">Secure access to your ${destinationLabel}</div>
        </div>
        <div style="border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 16px 16px; padding: 28px; background: #ffffff;">
          <p style="margin-top: 0;">Use the secure link below to access your ${destinationLabel.toLowerCase()}.</p>
          <p style="color: #475569;">This link expires in 15 minutes and works one time.</p>
          <div style="text-align: center; margin: 28px 0;">
            <a href="${accessUrl}" style="display: inline-block; background: #06b6d4; color: #082f49; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 700;">
              ${actionLabel}
            </a>
          </div>
          <p style="font-size: 13px; color: #64748b; word-break: break-all;">
            If the button does not work, copy and paste this link into your browser:<br />
            <a href="${accessUrl}" style="color: #2563eb;">${accessUrl}</a>
          </p>
        </div>
      </div>
    `,
    text: `Use this secure link to access your ${destinationLabel}: ${accessUrl}\n\nThis link expires in 15 minutes and works one time.`,
  });
}
