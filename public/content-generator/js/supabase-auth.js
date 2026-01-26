// Supabase Auth Configuration
// Shared across all pages - GovCon Content Generator project
// Version: 2.4 - Using correct Supabase project
console.log('[Auth] Supabase Auth v2.4 loaded');

const SUPABASE_URL = 'https://krpyelfrbicmvsmwovti.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtycHllbGZyYmljbXZzbXdvdnRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwNzU1MDAsImV4cCI6MjA4MzY1MTUwMH0.xI3qosl35ieKa5ObeExh0BiSwDdoZy74lZQWg1Fzn6M';

// Detect base path for proxy support (e.g., /content-generator/)
function getBasePath() {
    const path = window.location.pathname;
    if (path.startsWith('/content-generator')) {
        return '/content-generator/';
    }
    return '/';
}

// Get full URL for app pages
function getAppUrl(page) {
    return getBasePath() + page;
}

// Check if Supabase SDK is loaded
if (typeof window.supabase === 'undefined') {
    console.error('Supabase SDK not loaded. Please check your internet connection.');
    // Create a dummy SupabaseAuth to prevent errors - the page will handle this gracefully
    window.SupabaseAuth = {
        initAuth: async () => null,
        loadUserProfile: async () => null,
        saveUserProfile: async () => null,
        requireAuth: () => false,
        getUserTier: () => null,
        hasTierAccess: () => false,
        signOut: async () => { window.location.href = getAppUrl('auth'); },
        getAuthHeaders: () => ({}),
        get user() { return null; },
        get session() { return null; },
        get profile() { return null; }
    };
    // Don't throw - let the page handle the missing SDK gracefully
} else {

// Initialize Supabase client with explicit session persistence
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        storageKey: 'gcg-auth',
        storage: window.localStorage,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});

// Auth state management
let currentUser = null;
let currentSession = null;
let userProfile = null;

// Initialize auth state
async function initAuth() {
    console.log('[Auth] initAuth started');
    try {
        console.log('[Auth] Calling getSession...');
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        console.log('[Auth] getSession complete:', session ? 'has session' : 'no session');

        if (error) {
            console.error('[Auth] getSession error:', error);
            return null;
        }

        if (session) {
            currentSession = session;
            currentUser = session.user;
            console.log('[Auth] User ID:', currentUser.id);

            // Load profile with timeout to prevent hanging
            console.log('[Auth] Loading user profile...');
            try {
                await Promise.race([
                    loadUserProfile(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Profile load timeout')), 5000))
                ]);
                console.log('[Auth] Profile loaded successfully');
            } catch (profileError) {
                console.warn('[Auth] Profile load failed/timeout, continuing without profile:', profileError.message);
                // Continue without profile - don't block auth
            }

            console.log('[Auth] initAuth complete, returning session');
            return session;
        }

        console.log('[Auth] No session found');
        return null;
    } catch (error) {
        console.error('[Auth] Init auth error:', error);
        return null;
    }
}

// Load user profile from database
async function loadUserProfile() {
    console.log('[Auth] loadUserProfile called');
    if (!currentUser) {
        console.log('[Auth] No current user, skipping profile load');
        return null;
    }

    try {
        console.log('[Auth] Querying user_profiles table for:', currentUser.id);
        const { data, error } = await supabaseClient
            .from('user_profiles')
            .select('*')
            .eq('user_id', currentUser.id)
            .single();

        console.log('[Auth] user_profiles query complete:', { data: !!data, error: error?.code });

        if (error && error.code !== 'PGRST116') {
            console.error('[Auth] Profile load error:', error);
            return null;
        }

        userProfile = data;
        console.log('[Auth] Profile set:', userProfile?.tier || 'no tier');
        return data;
    } catch (error) {
        console.error('[Auth] Load profile exception:', error);
        return null;
    }
}

// Save user profile
async function saveUserProfile(profileData) {
    if (!currentUser) {
        console.error('[Auth] Cannot save profile - no current user');
        return null;
    }

    try {
        // Validate UUID before write operation
        const userId = validateUserId(currentUser.id);
        console.log('[Auth] Saving profile for user:', userId);

        const saveData = {
            ...profileData,
            updated_at: new Date().toISOString()
        };
        console.log('[Auth] Profile data to save:', Object.keys(saveData));

        // First, check if profile exists
        const { data: existingProfile } = await supabaseClient
            .from('user_profiles')
            .select('id')
            .eq('user_id', userId)
            .single();

        let data, error;

        if (existingProfile) {
            // UPDATE existing profile
            console.log('[Auth] Updating existing profile');
            const result = await supabaseClient
                .from('user_profiles')
                .update(saveData)
                .eq('user_id', userId)
                .select()
                .single();
            data = result.data;
            error = result.error;
        } else {
            // INSERT new profile
            console.log('[Auth] Creating new profile');
            const result = await supabaseClient
                .from('user_profiles')
                .insert({
                    user_id: userId,
                    ...saveData
                })
                .select()
                .single();
            data = result.data;
            error = result.error;
        }

        if (error) {
            console.error('[Auth] Profile save error:', error.message, error.code);
            return null;
        }

        console.log('[Auth] Profile saved successfully:', data?.company_name || 'no company name');
        userProfile = data;
        return data;
    } catch (error) {
        console.error('[Auth] Save profile exception:', error);
        return null;
    }
}

// Check if user has access (is logged in)
function requireAuth(redirectTo = '/auth') {
    if (!currentSession) {
        window.location.href = redirectTo;
        return false;
    }
    return true;
}

// Get user's tier (returns null if no tier)
function getUserTier() {
    return userProfile?.tier || null;
}

// Check if user has specific tier access
function hasTierAccess(requiredTier) {
    const tierLevels = {
        'content-engine': 1,
        'full-fix': 2
    };

    const userTier = getUserTier();
    if (!userTier) return false; // No tier = no access

    const userTierLevel = tierLevels[userTier] || 0;
    const requiredTierLevel = tierLevels[requiredTier] || 0;

    return userTierLevel >= requiredTierLevel;
}

// Sign out
async function signOut() {
    try {
        await supabaseClient.auth.signOut();
        currentUser = null;
        currentSession = null;
        userProfile = null;
        window.location.href = getAppUrl('auth');
    } catch (error) {
        console.error('Sign out error:', error);
    }
}

// Get auth headers for API calls
function getAuthHeaders() {
    if (!currentSession) return {};
    return {
        'Authorization': `Bearer ${currentSession.access_token}`,
        'Content-Type': 'application/json'
    };
}

// UUID validation guard - ensures we never accidentally use email as user_id
function validateUserId(userId) {
    if (!userId) {
        console.error('[Auth Guard] No user ID provided');
        throw new Error('No authenticated user');
    }
    // UUID format: 8-4-4-4-12 hex characters (e.g., 550e8400-e29b-41d4-a716-446655440000)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof userId !== 'string' || !uuidRegex.test(userId)) {
        console.error('[Auth Guard] Invalid UUID format:', userId);
        throw new Error('Invalid user ID format - expected UUID');
    }
    return userId;
}

// Get validated user ID for write operations
function getValidatedUserId() {
    if (!currentUser?.id) {
        throw new Error('No authenticated user');
    }
    return validateUserId(currentUser.id);
}

// ============================================
// SAFE WRITE WRAPPERS - Bulletproof user_id injection
// ============================================

/**
 * Safe insert - automatically injects validated user_id
 * @param {string} table - Table name
 * @param {object} data - Data to insert (user_id will be added automatically)
 * @returns {Promise} Supabase response
 */
async function safeInsert(table, data) {
    const userId = getValidatedUserId();
    console.log(`[SafeWrite] INSERT into ${table} for user ${userId}`, data);
    try {
        // Don't use .select() as it can cause hangs with some RLS configurations
        const result = await supabaseClient.from(table).insert({ ...data, user_id: userId });
        if (result.error) {
            console.error(`[SafeWrite] INSERT failed:`, result.error);
        } else {
            console.log(`[SafeWrite] INSERT success`);
        }
        return result;
    } catch (err) {
        console.error(`[SafeWrite] INSERT exception:`, err);
        return { data: null, error: err };
    }
}

/**
 * Safe update - automatically validates user_id ownership
 * @param {string} table - Table name
 * @param {string} id - Row ID to update
 * @param {object} updates - Fields to update
 * @returns {Promise} Supabase response
 */
async function safeUpdate(table, id, updates) {
    const userId = getValidatedUserId();
    console.log(`[SafeWrite] UPDATE ${table} id=${id} for user ${userId}`);
    return supabaseClient
        .from(table)
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId);
}

/**
 * Safe delete - automatically validates user_id ownership
 * @param {string} table - Table name
 * @param {string} id - Row ID to delete
 * @returns {Promise} Supabase response
 */
async function safeDelete(table, id) {
    const userId = getValidatedUserId();
    console.log(`[SafeWrite] DELETE from ${table} id=${id} for user ${userId}`);
    return supabaseClient
        .from(table)
        .delete()
        .eq('id', id)
        .eq('user_id', userId);
}

/**
 * Safe upsert - automatically injects validated user_id
 * @param {string} table - Table name
 * @param {object} data - Data to upsert (user_id will be added automatically)
 * @param {object} options - Upsert options (e.g., { onConflict: 'user_id' })
 * @returns {Promise} Supabase response
 */
async function safeUpsert(table, data, options = {}) {
    const userId = getValidatedUserId();
    console.log(`[SafeWrite] UPSERT into ${table} for user ${userId}`);
    return supabaseClient
        .from(table)
        .upsert({ ...data, user_id: userId, updated_at: new Date().toISOString() }, options);
}

/**
 * Safe select - automatically filters by user_id
 * @param {string} table - Table name
 * @param {string} columns - Columns to select (default '*')
 * @returns {object} Query builder with user_id filter applied
 */
function safeSelect(table, columns = '*') {
    const userId = getValidatedUserId();
    return supabaseClient
        .from(table)
        .select(columns)
        .eq('user_id', userId);
}

/**
 * Direct Supabase REST API fetch - for advanced operations
 * Uses current session token for authentication
 * Includes automatic retry with exponential backoff (3 attempts)
 * @param {string} method - HTTP method (GET, POST, PATCH, DELETE)
 * @param {string} path - REST API path (e.g., 'content_library?user_id=eq.xxx')
 * @param {object} body - Request body (for POST/PATCH)
 * @param {object} options - Additional options { prefer: 'resolution=merge-duplicates', retries: 3 }
 * @returns {Promise} JSON response
 */
async function supabaseRest(method, path, body = null, options = {}) {
    const session = currentSession;
    const token = session?.access_token;

    if (!token) {
        console.error('[REST] No active session');
        throw new Error('No active session – please log in again');
    }

    const headers = {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
    };

    // Add Prefer header for upserts
    if (options.prefer) {
        headers['Prefer'] = options.prefer;
    }

    const url = `${SUPABASE_URL}/rest/v1/${path}`;
    const maxRetries = options.retries ?? 3;

    // Retry loop with exponential backoff
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[REST] ${method} ${path} (attempt ${attempt}/${maxRetries})`);

            const response = await fetch(url, {
                method,
                headers,
                body: body ? JSON.stringify(body) : null
            });

            if (!response.ok) {
                const text = await response.text();
                // Don't retry client errors (4xx), only server errors (5xx)
                if (response.status >= 400 && response.status < 500) {
                    console.error(`[REST] Client error ${response.status}:`, text.substring(0, 200));
                    throw new Error(`Supabase error ${response.status}: ${text.substring(0, 200)}`);
                }
                throw new Error(`Server error ${response.status}: ${text.substring(0, 100)}`);
            }

            // Handle empty responses (e.g., DELETE)
            const contentLength = response.headers.get('content-length');
            if (contentLength === '0' || response.status === 204) {
                return { success: true };
            }

            return await response.json();

        } catch (error) {
            console.warn(`[REST] Attempt ${attempt} failed:`, error.message);

            // Don't retry on final attempt or client errors
            if (attempt === maxRetries || error.message.includes('Supabase error 4')) {
                throw error;
            }

            // Exponential backoff: 1s, 2s, 3s
            const delay = 1000 * attempt;
            console.log(`[REST] Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

/**
 * Safe wrapper for Supabase calls - refreshes token and handles errors gracefully
 * @param {Function} fn - Async function to execute
 * @param {object} options - { silent: false, showAlert: true }
 * @returns {Promise} Result of fn()
 */
async function safeSupabaseCall(fn, options = {}) {
    const { silent = false, showAlert = true } = options;

    try {
        // Refresh session to ensure token is fresh
        if (!silent) console.log('[Safe] Refreshing session...');
        const { error: refreshError } = await supabaseClient.auth.refreshSession();
        if (refreshError) {
            console.warn('[Safe] Session refresh failed:', refreshError.message);
            // Continue anyway - token might still be valid
        }

        return await fn();

    } catch (error) {
        console.error('[Safe] Call failed:', error.message);

        // Handle specific error types with user-friendly messages
        if (showAlert) {
            if (error.message.includes('No active session')) {
                alert('Your session has expired. Please log in again.');
                window.location.href = getAppUrl('auth');
            } else if (error.message.includes('406') || error.message.includes('<html>') || error.message.includes('<!DOCTYPE')) {
                alert('Server returned an unexpected response. This is usually temporary — please try again in a moment.');
            } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                alert('Network error. Please check your connection and try again.');
            }
        }

        throw error;
    }
}

// Listen for auth state changes - Global init script
supabaseClient.auth.onAuthStateChange((event, session) => {
    console.log('[Auth] Auth state change:', event, session?.user?.id);

    if (session) {
        // Update session for any event that provides one (SIGNED_IN, TOKEN_REFRESHED, etc.)
        currentSession = session;
        currentUser = session.user;
        // Store userId globally for quick access
        window.currentUserId = session.user.id;
        // Note: Don't call loadUserProfile() here - initAuth() handles it with timeout protection
    } else if (event === 'SIGNED_OUT' || !session) {
        currentUser = null;
        currentSession = null;
        userProfile = null;
        window.currentUserId = null;
        // Redirect to auth if unexpectedly signed out
        window.location.href = getAppUrl('auth');
    }
});

// Export for use in pages
window.SupabaseAuth = {
    client: supabaseClient,
    initAuth,
    loadUserProfile,
    saveUserProfile,
    requireAuth,
    getUserTier,
    hasTierAccess,
    signOut,
    getAuthHeaders,
    validateUserId,
    getValidatedUserId,
    // Safe write wrappers - bulletproof user_id injection
    safeInsert,
    safeUpdate,
    safeDelete,
    safeUpsert,
    safeSelect,
    supabaseRest,      // Direct REST API access
    safeSupabaseCall,  // Wrapper with session refresh & error handling
    get user() { return currentUser; },
    get session() { return currentSession; },
    get profile() { return userProfile; }
};

} // End of else block (Supabase SDK loaded)
