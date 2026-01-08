-- Purchases table for paid products (Lemon Squeezy orders)
CREATE TABLE IF NOT EXISTS purchases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT,
  order_id TEXT,
  license_key TEXT,
  amount_paid INTEGER DEFAULT 0,
  status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'refunded', 'pending')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for quick lookups by email
CREATE INDEX IF NOT EXISTS idx_purchases_email ON purchases(user_email);

-- Index for product access checks
CREATE INDEX IF NOT EXISTS idx_purchases_email_product ON purchases(user_email, product_id);

-- Leads table for free resource email capture
CREATE TABLE IF NOT EXISTS leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  company TEXT,
  source TEXT, -- which resource they signed up for
  resources_accessed TEXT[] DEFAULT '{}', -- array of resource IDs they've accessed
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for email lookups
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);

-- Row Level Security (RLS) Policies

-- Enable RLS
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Purchases: Users can only read their own purchases
CREATE POLICY "Users can view own purchases" ON purchases
  FOR SELECT USING (auth.jwt() ->> 'email' = user_email);

-- Purchases: Service role can do everything (for webhooks)
CREATE POLICY "Service role full access to purchases" ON purchases
  FOR ALL USING (auth.role() = 'service_role');

-- Leads: Allow insert from anyone (for signup forms)
CREATE POLICY "Anyone can insert leads" ON leads
  FOR INSERT WITH CHECK (true);

-- Leads: Users can view their own lead record
CREATE POLICY "Users can view own lead" ON leads
  FOR SELECT USING (auth.jwt() ->> 'email' = email);

-- Leads: Service role can do everything
CREATE POLICY "Service role full access to leads" ON leads
  FOR ALL USING (auth.role() = 'service_role');

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to auto-update updated_at
CREATE TRIGGER update_purchases_updated_at
  BEFORE UPDATE ON purchases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
