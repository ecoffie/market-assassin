-- Stripe Data Cache Tables
-- This enables fast local queries instead of hitting Stripe API every time

-- 1. Stripe Customers Table
CREATE TABLE IF NOT EXISTS stripe_customers (
    id TEXT PRIMARY KEY,  -- Stripe customer ID (cus_xxx)
    email TEXT NOT NULL,
    name TEXT,
    phone TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now(),
    livemode BOOLEAN DEFAULT true,
    deleted BOOLEAN DEFAULT false
);

-- Index for fast email lookups
CREATE INDEX IF NOT EXISTS idx_stripe_customers_email ON stripe_customers(email);
CREATE INDEX IF NOT EXISTS idx_stripe_customers_email_lower ON stripe_customers(LOWER(email));

-- 2. Stripe Charges Table (all successful payments)
CREATE TABLE IF NOT EXISTS stripe_charges (
    id TEXT PRIMARY KEY,  -- Stripe charge ID (ch_xxx)
    customer_id TEXT REFERENCES stripe_customers(id) ON DELETE SET NULL,
    amount INTEGER NOT NULL,  -- in cents
    currency TEXT DEFAULT 'usd',
    status TEXT NOT NULL,  -- succeeded, pending, failed
    description TEXT,
    receipt_email TEXT,
    invoice_id TEXT,
    payment_intent_id TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL,
    livemode BOOLEAN DEFAULT true,
    refunded BOOLEAN DEFAULT false,
    amount_refunded INTEGER DEFAULT 0
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_stripe_charges_customer ON stripe_charges(customer_id);
CREATE INDEX IF NOT EXISTS idx_stripe_charges_created ON stripe_charges(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_charges_amount ON stripe_charges(amount);
CREATE INDEX IF NOT EXISTS idx_stripe_charges_status ON stripe_charges(status);

-- 3. Stripe Subscriptions Table
CREATE TABLE IF NOT EXISTS stripe_subscriptions (
    id TEXT PRIMARY KEY,  -- Stripe subscription ID (sub_xxx)
    customer_id TEXT REFERENCES stripe_customers(id) ON DELETE SET NULL,
    status TEXT NOT NULL,  -- active, past_due, canceled, etc.
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT false,
    canceled_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    trial_start TIMESTAMPTZ,
    trial_end TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now(),
    livemode BOOLEAN DEFAULT true,
    -- Denormalized for fast queries
    plan_id TEXT,
    plan_amount INTEGER,
    plan_interval TEXT  -- month, year
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_customer ON stripe_subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_status ON stripe_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_created ON stripe_subscriptions(created_at DESC);

-- 4. Customer Classifications Table (computed from charge/subscription data)
CREATE TABLE IF NOT EXISTS customer_classifications (
    email TEXT PRIMARY KEY,
    customer_id TEXT,

    -- Classification result
    classification TEXT NOT NULL,  -- ultimate_giant, inner_circle_active, inner_circle_churned, pro_giant, pro_member_active, pro_member_churned, mi_subscription, starter, standalone, free

    -- Access levels
    briefings_access TEXT,  -- lifetime, 1_year, subscription, none
    briefings_expiry TIMESTAMPTZ,

    -- Bundle info
    bundle_tier TEXT,  -- Ultimate Bundle, Pro Giant Bundle, Starter Bundle

    -- Stripe spend data
    total_spend INTEGER DEFAULT 0,  -- in cents
    charge_count INTEGER DEFAULT 0,
    first_charge_at TIMESTAMPTZ,
    last_charge_at TIMESTAMPTZ,

    -- Subscription status
    has_active_subscription BOOLEAN DEFAULT false,
    subscription_type TEXT,  -- inner_circle, pro_member, mi

    -- Products purchased (array of product names)
    products_purchased TEXT[] DEFAULT '{}',

    -- Metadata
    classified_at TIMESTAMPTZ DEFAULT now(),
    classification_version INTEGER DEFAULT 1,

    -- Audit fields
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_customer_classifications_classification ON customer_classifications(classification);
CREATE INDEX IF NOT EXISTS idx_customer_classifications_briefings_access ON customer_classifications(briefings_access);
CREATE INDEX IF NOT EXISTS idx_customer_classifications_customer ON customer_classifications(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_classifications_bundle ON customer_classifications(bundle_tier);

-- 5. Stripe Webhook Log (for debugging)
CREATE TABLE IF NOT EXISTS stripe_webhook_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT UNIQUE NOT NULL,  -- Stripe event ID
    event_type TEXT NOT NULL,
    object_id TEXT,  -- ID of the object (charge, customer, etc.)
    object_type TEXT,
    livemode BOOLEAN DEFAULT true,
    processed BOOLEAN DEFAULT false,
    error_message TEXT,
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_log_event_type ON stripe_webhook_log(event_type);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_log_created ON stripe_webhook_log(created_at DESC);

-- 6. Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_stripe_customers_updated_at ON stripe_customers;
CREATE TRIGGER update_stripe_customers_updated_at
    BEFORE UPDATE ON stripe_customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_stripe_subscriptions_updated_at ON stripe_subscriptions;
CREATE TRIGGER update_stripe_subscriptions_updated_at
    BEFORE UPDATE ON stripe_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_customer_classifications_updated_at ON customer_classifications;
CREATE TRIGGER update_customer_classifications_updated_at
    BEFORE UPDATE ON customer_classifications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 7. View for easy querying of customer data with classification
CREATE OR REPLACE VIEW customer_stripe_summary AS
SELECT
    c.email,
    c.id as customer_id,
    c.name,
    cc.classification,
    cc.briefings_access,
    cc.briefings_expiry,
    cc.bundle_tier,
    cc.total_spend,
    cc.charge_count,
    cc.products_purchased,
    cc.has_active_subscription,
    cc.subscription_type,
    c.created_at as customer_created,
    cc.classified_at
FROM stripe_customers c
LEFT JOIN customer_classifications cc ON LOWER(c.email) = LOWER(cc.email)
WHERE c.livemode = true AND c.deleted = false;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON stripe_customers TO service_role;
GRANT SELECT, INSERT, UPDATE ON stripe_charges TO service_role;
GRANT SELECT, INSERT, UPDATE ON stripe_subscriptions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_classifications TO service_role;
GRANT SELECT, INSERT ON stripe_webhook_log TO service_role;
GRANT SELECT ON customer_stripe_summary TO service_role;

-- Comments
COMMENT ON TABLE stripe_customers IS 'Cached Stripe customer data, synced via webhook';
COMMENT ON TABLE stripe_charges IS 'Cached Stripe charge data for fast classification queries';
COMMENT ON TABLE stripe_subscriptions IS 'Cached Stripe subscription data';
COMMENT ON TABLE customer_classifications IS 'Computed customer classifications based on Stripe data';
COMMENT ON TABLE stripe_webhook_log IS 'Log of processed Stripe webhook events';
