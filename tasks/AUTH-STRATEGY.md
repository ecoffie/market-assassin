# Authentication Strategy: Single Sign-On & CMMC Compliance

## Current State Analysis

### How Auth Works Today

| Tool | Auth Method | Storage | Problem |
|------|-------------|---------|---------|
| **Market Assassin** | Email-only gate | KV: `ma:{email}` | No password |
| **Content Reaper** | Email-only gate | KV: `contentgen:{email}` | No password |
| **Contractor Database** | Email + Token | KV: `dbtoken:{token}` | No password |
| **Recompete Tracker** | Email-only gate | KV: `recompete:{email}` | No password |
| **Opportunity Hunter** | Email-only gate | KV: `ospro:{email}` | No password |
| **Daily Briefings** | Email-only gate | KV: `briefings:{email}` | No password |
| **Action Planner** | Email + Password | Supabase Auth | ✅ Has proper auth |

### The Problems

1. **No Real Authentication** - Just email entry, no verification
2. **No Password** - Anyone with an email can claim access
3. **No Session Management** - Can't log out, can't revoke access
4. **No Audit Trail** - Can't track who accessed what when
5. **No CMMC Compliance** - Zero identity verification
6. **Fragmented Experience** - Users enter email separately for each tool

---

## CMMC Authentication Requirements

Your cyber guy is right. For CMMC Level 2 compliance (required for CUI/FCI handling), you need:

### Mandatory Requirements ([Source: CMMC Dashboard](https://cmmcdashboard.com/blog/identification-authentication-cmmc-compliance))

| Requirement | Current State | Required |
|-------------|---------------|----------|
| Unique user IDs | ❌ Email only | ✅ Username/email |
| Password authentication | ❌ None | ✅ 12+ chars, complexity |
| MFA for privileged access | ❌ None | ✅ TOTP/Hardware key |
| MFA for network access | ❌ None | ✅ Required at Level 2 |
| Session management | ❌ None | ✅ Timeouts, logout |
| Password hashing | ❌ N/A | ✅ bcrypt/Argon2 |
| Audit logging | ❌ None | ✅ Login attempts |

### What This Means

If your customers are federal contractors handling CUI/FCI (which they are), your tool should support CMMC-compliant auth so **their use of your tool doesn't break their compliance**.

---

## Recommendation: Unified Auth System

### Option 1: Supabase Auth (Recommended)
**You already have this for Action Planner - extend it to all tools**

**Pros:**
- Already integrated
- Built-in email/password auth
- MFA support (TOTP)
- Session management
- Row-level security
- Free tier generous

**Cons:**
- Migration effort
- Need to update all tools

### Option 2: Auth0/Clerk
**Third-party auth provider**

**Pros:**
- Enterprise features
- Easy MFA
- Social logins
- Compliance certifications

**Cons:**
- Cost ($$$)
- Another vendor
- Migration complexity

### Option 3: Custom Auth
**Build your own**

**Pros:**
- Full control

**Cons:**
- Security risk
- Time to build
- Not recommended

---

## Implementation Plan: Unified Supabase Auth

### Phase 1: Core Auth System (Week 1-2)

#### 1.1 Database Schema Update

```sql
-- Extend user_profiles to be the auth source of truth
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS
  auth_user_id UUID REFERENCES auth.users(id),
  password_changed_at TIMESTAMPTZ,
  mfa_enabled BOOLEAN DEFAULT false,
  mfa_secret TEXT,
  last_login_at TIMESTAMPTZ,
  login_count INTEGER DEFAULT 0,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMPTZ;

-- Audit log for compliance
CREATE TABLE auth_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  event_type TEXT NOT NULL, -- login, logout, failed_login, password_change, mfa_enable
  ip_address TEXT,
  user_agent TEXT,
  success BOOLEAN,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session tracking
CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  session_token TEXT UNIQUE NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
```

#### 1.2 New Auth Pages

```
/login          - Unified login page
/register       - New user registration (links to Stripe for purchase)
/forgot-password - Password reset
/account        - Account settings (change password, enable MFA)
/account/security - MFA setup, active sessions
```

#### 1.3 Auth Flow

```
1. User visits any tool (e.g., /market-assassin)
2. Middleware checks for valid session
3. No session → Redirect to /login
4. User logs in with email + password
5. If MFA enabled → Prompt for TOTP code
6. Create session, redirect to requested tool
7. Session stored in cookie + database
8. All tools share the same session
```

### Phase 2: Migrate Existing Users (Week 2-3)

#### 2.1 Migration Strategy

```typescript
// For each user with KV access:
// 1. Create Supabase auth user with temporary password
// 2. Link to existing user_profiles record
// 3. Send "Set Your Password" email
// 4. Keep KV access as fallback during transition

async function migrateUser(email: string) {
  // Check if already migrated
  const { data: existing } = await supabase
    .from('user_profiles')
    .select('auth_user_id')
    .eq('email', email)
    .single();

  if (existing?.auth_user_id) return; // Already migrated

  // Create auth user
  const tempPassword = generateSecurePassword();
  const { data: authUser } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });

  // Link to profile
  await supabase
    .from('user_profiles')
    .update({ auth_user_id: authUser.user.id })
    .eq('email', email);

  // Send password setup email
  await sendPasswordSetupEmail(email);
}
```

#### 2.2 Transition Period

- **Week 1-2:** New auth system live, both old and new work
- **Week 3-4:** Email all users to set passwords
- **Week 5-6:** Require password for new sessions
- **Week 7+:** Deprecate email-only access

### Phase 3: MFA Implementation (Week 3-4)

#### 3.1 TOTP Setup

```typescript
// Using otplib for TOTP
import { authenticator } from 'otplib';

export async function enableMFA(userId: string) {
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(
    userEmail,
    'GovCon Giants',
    secret
  );

  // Store encrypted secret
  await supabase
    .from('user_profiles')
    .update({
      mfa_secret: encrypt(secret),
      mfa_enabled: false // Not enabled until verified
    })
    .eq('auth_user_id', userId);

  return { secret, qrCode: await generateQRCode(otpauth) };
}

export async function verifyMFA(userId: string, token: string) {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('mfa_secret')
    .eq('auth_user_id', userId)
    .single();

  const secret = decrypt(profile.mfa_secret);
  const isValid = authenticator.verify({ token, secret });

  if (isValid) {
    await supabase
      .from('user_profiles')
      .update({ mfa_enabled: true })
      .eq('auth_user_id', userId);
  }

  return isValid;
}
```

### Phase 4: Unified Dashboard (Week 4-5)

#### 4.1 New User Portal

```
/dashboard
├── /dashboard              - Overview (all tools, recent activity)
├── /dashboard/tools        - Access your purchased tools
├── /dashboard/briefings    - Daily Briefings
├── /dashboard/pipeline     - Pipeline CRM (future)
├── /dashboard/account      - Profile & settings
├── /dashboard/billing      - Subscriptions & invoices
└── /dashboard/team         - Team management (future)
```

#### 4.2 Single Navigation

```typescript
// Shared nav component across all tools
const tools = [
  { name: 'Market Assassin', href: '/market-assassin', access: 'access_assassin_standard' },
  { name: 'Content Reaper', href: '/content-generator', access: 'access_content_standard' },
  { name: 'Contractor Database', href: '/contractor-database', access: 'access_contractor_db' },
  { name: 'Recompete Tracker', href: '/recompete', access: 'access_recompete' },
  { name: 'Opportunity Hunter', href: '/opportunity-hunter', access: 'access_hunter_pro' },
  { name: 'Daily Briefings', href: '/briefings', access: 'access_briefings' },
];

// Show only tools user has access to
const userTools = tools.filter(tool => user.profile[tool.access]);
```

---

## Password Requirements (CMMC-Compliant)

Based on [NIST SP 800-63B](https://pages.nist.gov/800-63-3/sp800-63b.html) and CMMC:

```typescript
const PASSWORD_REQUIREMENTS = {
  minLength: 12,        // CMMC requires 12+
  maxLength: 128,       // Allow long passphrases
  requireUppercase: false, // NIST: Length > complexity
  requireLowercase: false,
  requireNumbers: false,
  requireSpecial: false,
  checkBreached: true,  // Check against HaveIBeenPwned
  noCommonWords: true,  // Block 'password', 'govcon', etc.
};

// Validation
function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (password.length < 12) {
    errors.push('Password must be at least 12 characters');
  }

  if (password.length > 128) {
    errors.push('Password must be less than 128 characters');
  }

  // Check common passwords
  const commonPasswords = ['password', 'govcon', 'federal', '123456789012'];
  if (commonPasswords.some(p => password.toLowerCase().includes(p))) {
    errors.push('Password contains common words');
  }

  return { valid: errors.length === 0, errors };
}
```

---

## Session Management

```typescript
const SESSION_CONFIG = {
  maxAge: 24 * 60 * 60,      // 24 hours
  idleTimeout: 30 * 60,       // 30 minutes idle
  maxConcurrentSessions: 5,   // Per user
  rememberMe: 30 * 24 * 60 * 60, // 30 days if "remember me"
};

// Middleware for all protected routes
export async function authMiddleware(request: NextRequest) {
  const sessionToken = request.cookies.get('session')?.value;

  if (!sessionToken) {
    return NextResponse.redirect('/login');
  }

  const { data: session } = await supabase
    .from('user_sessions')
    .select('*, user_profiles(*)')
    .eq('session_token', sessionToken)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (!session) {
    return NextResponse.redirect('/login');
  }

  // Check idle timeout
  const lastActivity = new Date(session.last_activity_at);
  const now = new Date();
  const idleMinutes = (now - lastActivity) / 1000 / 60;

  if (idleMinutes > 30) {
    await revokeSession(sessionToken);
    return NextResponse.redirect('/login?reason=idle');
  }

  // Update last activity
  await supabase
    .from('user_sessions')
    .update({ last_activity_at: now.toISOString() })
    .eq('session_token', sessionToken);

  return NextResponse.next();
}
```

---

## Audit Logging (CMMC Requirement)

```typescript
export async function logAuthEvent(
  email: string,
  eventType: 'login' | 'logout' | 'failed_login' | 'password_change' | 'mfa_enable' | 'mfa_disable',
  success: boolean,
  metadata?: Record<string, unknown>
) {
  await supabase.from('auth_audit_log').insert({
    user_email: email,
    event_type: eventType,
    success,
    ip_address: getClientIP(),
    user_agent: getUserAgent(),
    metadata,
    created_at: new Date().toISOString(),
  });
}

// Log all auth events
await logAuthEvent(email, 'login', true, { mfa_used: true });
await logAuthEvent(email, 'failed_login', false, { reason: 'invalid_password' });
await logAuthEvent(email, 'password_change', true);
```

---

## Migration Timeline

| Week | Milestone |
|------|-----------|
| 1 | Auth schema, login/register pages |
| 2 | Middleware, session management |
| 3 | Migrate existing users, send emails |
| 4 | MFA implementation |
| 5 | Unified dashboard |
| 6 | Deprecate email-only access |
| 7 | Audit logging, compliance report |
| 8 | Documentation, user training |

---

## Cost Impact

| Item | Monthly Cost |
|------|-------------|
| Supabase Auth | $0 (included in current plan) |
| MFA SMS (optional) | $0.05/message (use TOTP instead) |
| HaveIBeenPwned API | $0 (free for non-commercial) |
| **Total** | **$0 additional** |

---

## Benefits

### For Users
- One login for all tools
- Better security (password + MFA)
- Session management (see active devices)
- Password reset capability

### For CMMC Compliance
- Meets IA.L2-3.5.1 (Identification)
- Meets IA.L2-3.5.2 (Authentication)
- Meets IA.L2-3.5.3 (MFA)
- Audit trail for assessments

### For Business
- Higher trust = higher conversions
- Enterprise sales enabled
- Reduced support (password resets automated)
- Foundation for team accounts

---

## Decision Required

**Recommendation:** Implement unified Supabase auth with optional MFA.

**Questions for you:**
1. Start with Phase 1 (basic auth) or jump to full MFA?
2. Require MFA for all users or make it optional?
3. Force existing users to set passwords or grandfather them?
4. Target timeline for completion?

---

## Sources

- [CMMC Dashboard: Identification & Authentication](https://cmmcdashboard.com/blog/identification-authentication-cmmc-compliance)
- [CMMC Password & MFA Requirements](https://cmmcdashboard.com/blog/passwords-mfa-wifi-cmmc-requirements)
- [Kiteworks: CMMC Authentication Requirements](https://www.kiteworks.com/cmmc-compliance/authentication-identification-requirement/)
- [NIST SP 800-63B: Digital Identity Guidelines](https://pages.nist.gov/800-63-3/sp800-63b.html)

---

*Created: March 11, 2026*
