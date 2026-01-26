-- Purchases table for paid products (Stripe orders)
-- Run this in Supabase SQL Editor

-- First, enable uuid extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create purchases table
CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  stripe_session_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  product_id TEXT NOT NULL,
  product_name TEXT,
  tier TEXT NOT NULL, -- e.g., 'hunter_pro', 'content_full_fix', 'assassin_premium'
  bundle TEXT, -- null or 'starter', 'ultimate', 'complete'
  amount DECIMAL(10,2),
  currency TEXT DEFAULT 'usd',
  status TEXT DEFAULT 'completed',
  purchased_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB
);

-- Indexes for quick lookups
CREATE INDEX IF NOT EXISTS idx_purchases_email ON purchases(email);
CREATE INDEX IF NOT EXISTS idx_purchases_user_id ON purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_stripe_session ON purchases(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_tier ON purchases(tier);
CREATE INDEX IF NOT EXISTS idx_purchases_email_product ON purchases(email, product_id);

-- Enable Row Level Security
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Users can read their own purchases (by email match from JWT)
CREATE POLICY "Users can read own purchases by email" ON purchases
  FOR SELECT USING (
    auth.jwt() ->> 'email' = email
  );

-- Users can read own purchases (by user_id if logged in)
CREATE POLICY "Users can read own purchases by user_id" ON purchases
  FOR SELECT USING (
    auth.uid() = user_id
  );

-- Service role can do everything (for webhooks and admin)
CREATE POLICY "Service role full access" ON purchases
  FOR ALL USING (
    auth.role() = 'service_role'
  );

-- Comments for documentation
COMMENT ON TABLE purchases IS 'Stores all Stripe purchases';
COMMENT ON COLUMN purchases.tier IS 'Product tier: hunter_pro, content_standard, content_full_fix, assassin_standard, assassin_premium, recompete, contractor_db';
COMMENT ON COLUMN purchases.bundle IS 'Bundle name if purchased as bundle: starter, ultimate, complete';
