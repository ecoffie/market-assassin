-- Supabase schema for GovCon Action Planner
-- Run this SQL in your Supabase SQL editor to create the required tables

-- Create user_plans table
CREATE TABLE IF NOT EXISTS user_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  phase_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  notes TEXT,
  due_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure one record per user per task
  UNIQUE(user_id, task_id)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_user_plans_user_id ON user_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_user_plans_phase_id ON user_plans(phase_id);
CREATE INDEX IF NOT EXISTS idx_user_plans_user_phase ON user_plans(user_id, phase_id);
CREATE INDEX IF NOT EXISTS idx_user_plans_completed ON user_plans(completed);

-- Enable Row Level Security (RLS)
ALTER TABLE user_plans ENABLE ROW LEVEL SECURITY;

-- Create policy: Users can only see and modify their own plans
CREATE POLICY "Users can view their own plans"
  ON user_plans FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert their own plans"
  ON user_plans FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Users can update their own plans"
  ON user_plans FOR UPDATE
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Users can delete their own plans"
  ON user_plans FOR DELETE
  USING (auth.uid()::text = user_id);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_user_plans_updated_at
  BEFORE UPDATE ON user_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();



