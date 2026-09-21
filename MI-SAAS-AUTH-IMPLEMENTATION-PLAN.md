# MI SaaS Auth Implementation Plan

## Deployment Status - May 9, 2026

Phase 1 is now deployed to production for MI beta:

- Email + password is the primary login path for MI Free, MI Pro, team, and internal users.
- 2FA remains available as an optional second step after password login.
- Forgot password and reset password flows are live.
- Account setup APIs are in place for existing purchasers/users who have entitlement but do not yet have a Supabase Auth identity.
- Entitlement remains separate from identity, so a user can have a login account without paid MI Pro access, and a purchaser can have MI access while still needing account setup.
- Admin account setup support is available through the new MI account setup route.

Production check: `https://tools.govcongiants.org/mi-beta` returned HTTP 200 after deployment.

Next work:

- Rebrand Supabase Auth email templates from legacy GovCon Content Generator language to Market Intelligence.
- Send account setup links to existing entitled MI users who do not yet have Supabase Auth accounts.
- Add an admin-facing account status panel for setup sent, setup completed, last login, entitlement, profile completion, and reset actions.
- Continue improving team/workspace identity before Deal Flow Board collaboration launches.

## Decision

Market Intelligence should use a standard SaaS login model:

1. Email + user-owned password
2. Email verification / account setup
3. Two-factor verification
4. Entitlement check
5. MI workspace access

This keeps the security posture we want, but removes the shared-password beta gate that does not scale to real customers, teams, or white-glove clients.

## Why This Matters

MI is becoming the customer operating system for GovCon Giants. Login cannot feel like a temporary beta door. It needs to support:

- Individual customer accounts
- Paid buyer access from Stripe
- Internal users
- Team invites
- White-glove clients with multiple users
- Later SSO for larger accounts
- Auditability when something breaks

The current flow is useful as a bridge, but it is not the final account system.

## Current State

Current MI beta flow:

- User enters email + shared MI password in `src/app/mi-beta/page.tsx`.
- `src/app/api/auth/two-factor/request/route.ts` checks that shared password.
- If valid, it emails a 6-digit code.
- `src/app/api/auth/two-factor/verify/route.ts` verifies the code and creates a 12-hour 2FA session token.
- Protected MI APIs check the 2FA session with `src/lib/two-factor-session.ts`.
- Access level is still determined separately through `/api/access/check` and entitlement data.

This gives us a working 2FA layer. The gap is that password authentication is not per-user.

## Target State

### Access Model

Keep the model separated:

- **Identity** answers: who is this person?
- **MI entitlement** answers: what product experience do they receive?
- **Staff role** answers: what internal/admin powers do they have?
- **Workspace role** answers: what team or client workspace can they work inside?

Customer-facing MI tiers:

- `mi_free`
- `mi_pro`
- `mi_team`
- `mi_enterprise` / white-glove

Internal users are not a customer tier. An employee can have a staff role like `admin`, `operator`, `support`, or `viewer`, and may also have an MI entitlement for testing, but those are separate concepts.

### Customer Login

Customer sees:

- Email
- Password
- Forgot password
- Create/setup account link if invited or recently purchased

After successful password login:

- Send 2FA code
- Verify 2FA code
- Check entitlement
- Route to MI

If no entitlement:

- Show account exists, but MI access is not active
- Offer correct next step: subscribe, contact support, or activate purchase

### Account Setup

New buyers and invited users should not receive a generic code-only login. They should receive:

- Account setup email
- Secure setup link
- Set password
- Confirm email
- Complete profile
- Turn on alerts/briefings

This is the onboarding flow, not just auth.

### Password Reset

Must include:

- Forgot password link
- Secure reset email
- Expiring reset token
- Password update
- Force 2FA after reset

### Staff Users

Staff users should use the same auth path, but with staff roles:

- `admin`
- `operator`
- `support`
- `viewer`

Staff access should not depend on a shared admin password long term.

### Teams

Team access should build on accounts, not shared logins:

- One organization/workspace
- Multiple individual users
- Invite by email
- Accept invite
- Role assignment
- Seat count / entitlement rules

This is required before Deal Flow Board becomes real collaboration software.

## Data Model

Use Supabase Auth as the identity source unless we have a strong reason not to. The repo already has Supabase Auth patterns in the Planner code, so this avoids inventing password storage.

Recommended tables:

### `user_accounts`

Maps app-level user identity to business context.

- `id`
- `auth_user_id`
- `email`
- `name`
- `company`
- `role`
- `status`
- `created_at`
- `last_login_at`

### `user_entitlements`

Keeps access separate from identity.

- `id`
- `email`
- `product`
- `tier`
- `source`
- `stripe_customer_id`
- `stripe_subscription_id`
- `starts_at`
- `expires_at`
- `status`

### `workspaces`

For teams and white-glove clients.

- `id`
- `name`
- `owner_user_id`
- `tier`
- `seat_limit`
- `created_at`

### `workspace_members`

- `workspace_id`
- `user_id`
- `role`
- `status`
- `invited_by`
- `joined_at`

### `account_invites`

- `id`
- `email`
- `workspace_id`
- `role`
- `token_hash`
- `expires_at`
- `accepted_at`
- `created_by`

## Migration Path

## Handling Current Users

We should not force every current user through a hard reset on day one. Current users need a bridge path based on what we already know about them.

### Current User Segments

1. **Paid MI / bundle / briefings users**
   - These users should be treated as entitled customers.
   - Send "Set up your MI account" email if they do not have a password account yet.
   - After password setup, require 2FA and route them into MI.
   - Do not ask them to repurchase.

2. **Existing free alert users**
   - Keep them in the free audience.
   - Let them create an account when they click from alerts or try to use MI.
   - After account setup, route them to profile completion and free alerts.
   - Upgrade prompts should come from behavior, not from blocking basic access.

3. **Users with profiles already completed**
   - Preserve their profile data.
   - Do not make them re-enter NAICS, agencies, keywords, or business type.
   - On first login, show a quick "confirm your profile" step instead of a blank setup wizard.

4. **Staff users**
   - Create staff accounts manually or through admin invites.
   - Require 2FA.
   - Assign admin/operator/support/viewer roles.
   - Staff users should not share the admin password long term.

5. **White-glove and team clients**
   - Create a workspace.
   - Invite each person individually.
   - Assign roles.
   - Keep team activity tied to individual users so we can see who is actually using MI.

### Migration Experience

For existing users, the first login should feel like account activation, not like a new product barrier:

1. User enters email.
2. System recognizes email from purchases, briefings, alerts, or profile data.
3. If no password exists, send account setup link.
4. User sets password.
5. User completes 2FA.
6. System checks entitlement.
7. User lands in MI with existing profile/preferences loaded.

### Temporary Backward Compatibility

For the first rollout window, keep the existing 2FA session path available while account setup emails go out. That gives us a fallback if a buyer cannot complete password setup immediately.

Recommended window: 14-30 days.

After that window:

- Paid users must use email/password + 2FA.
- Free users can still access alerts through email links, but account login is required for MI workspace features.
- Admin/shared passwords should only remain for emergency internal use until internal roles are live.

### Current User Comms

Use plain language:

> We upgraded Market Intelligence accounts. Your access is already approved. Please set your password so your MI workspace, alerts, and briefings are protected by secure sign-in and 2FA.

Do not frame this as "we changed login." Frame it as protecting their MI workspace.

### Admin Support Needs

Before migration, admin needs to answer:

- Does this email have an account?
- Does this email have paid access?
- Did the setup email send?
- Did they complete password setup?
- Did they complete 2FA?
- Is their profile complete?
- When did they last log in?

Those should appear in the admin account management view.

### Phase 1: Account Foundation

- Create Supabase Auth account setup flow for MI.
- Keep current 2FA APIs.
- Replace shared MI password check with per-user password verification.
- Keep current entitlement check unchanged.
- Add `Forgot password`.

Result: normal SaaS login without losing 2FA.

### Phase 2: Buyer Onboarding

- After Stripe purchase, ensure account invite/setup email is sent.
- If user already has account, send "MI access activated" email.
- If no account, send "Set up your MI account" email.
- Route new users through profile completion.

Result: recent purchasers can actually get into the product and configure MI.

### Phase 3: Admin Account Management

- Admin can search user.
- See identity status, entitlement status, profile status, email delivery, last login.
- Resend setup email.
- Grant/revoke access.
- Force password reset.
- Force 2FA reset.

Result: support stops guessing.

### Phase 4: Team Access

- Workspace table and member roles.
- Invite email.
- Accept invite.
- Team role enforcement.
- Start preparing Deal Flow Board.

Result: MI supports customer teams, not just solo users.

### Phase 5: Enterprise Login

- Microsoft/Google login.
- SSO/SAML later for larger white-glove/team clients.
- Device/session list.
- Admin audit log.

Result: GovWin-style credibility for serious buyers.

## UX Flow

### Existing Customer

1. Enters email/password
2. Receives 2FA code
3. Enters code
4. Lands on MI dashboard

### New Buyer

1. Buys MI / bundle
2. Receives setup email
3. Sets password
4. Verifies 2FA
5. Completes profile
6. Sees first opportunities / briefings

### Staff User

1. Admin creates or invites user
2. User sets password
3. 2FA required
4. Role decides what admin/tool areas they see

### No Access

1. User logs in successfully
2. 2FA succeeds
3. Entitlement check fails
4. Page shows: "Your account is active, but MI access is not enabled."
5. Give support / upgrade / purchase activation path

## Important Product Rule

Identity is not entitlement. Staff role is not entitlement either.

Someone can have a valid login and still not have MI access. Someone can have paid access and still need to finish account setup. A staff user can have admin powers without being counted as a paid MI customer. The dashboard should show those as separate states.

## What We Should Build First

1. Supabase Auth login for MI
2. Password reset
3. Keep 2FA after password
4. Entitlement check after 2FA
5. Account setup email for purchasers
6. Admin resend setup link

This is the smallest version that feels like real SaaS.

## What We Should Not Do Yet

- Do not remove 2FA.
- Do not build SSO first.
- Do not build Deal Flow Board before team identity exists.
- Do not keep expanding shared-password auth.
- Do not mix profile completion, entitlement, and login into one confusing number.

## Success Metrics

The auth/onboarding system should make these numbers clear:

- New accounts created
- Existing users who logged in
- Purchasers missing account setup
- Users with access but incomplete profile
- Users who completed profile after onboarding email
- Users blocked by entitlement
- 2FA send failures
- Password reset volume
- Time from purchase to first MI session

The goal is not just "people can log in." The goal is: buyers can reach the point where MI helps them find and win federal contracts.
