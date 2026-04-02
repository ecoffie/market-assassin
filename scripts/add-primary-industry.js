/**
 * Add primary_industry column to user_notification_settings
 *
 * Usage: node scripts/add-primary-industry.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load env manually
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    envVars[key.trim()] = valueParts.join('=').trim();
  }
});

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = envVars.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function addPrimaryIndustryColumn() {
  console.log('Checking if primary_industry column exists...\n');

  // Try to select the column to see if it exists
  const { data, error } = await supabase
    .from('user_notification_settings')
    .select('user_email, primary_industry')
    .limit(1);

  if (error && error.message.includes('primary_industry')) {
    console.log('❌ Column does not exist. Please run this SQL in Supabase dashboard:\n');
    console.log(`
-- Add primary_industry column to user_notification_settings
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS primary_industry TEXT DEFAULT NULL;

-- Add comment
COMMENT ON COLUMN user_notification_settings.primary_industry IS
'Primary industry for prioritizing NAICS codes in briefings. Values: Construction, IT Services, Cybersecurity, Professional Services, Healthcare, Logistics & Supply, Facilities & Maintenance, Training & Education';

-- Create index
CREATE INDEX IF NOT EXISTS idx_user_notification_settings_primary_industry
ON user_notification_settings(primary_industry)
WHERE primary_industry IS NOT NULL;
`);
    return false;
  } else if (error) {
    console.log(`⚠️ Error: ${error.message}`);
    return false;
  } else {
    console.log('✅ primary_industry column already exists and is accessible');
    console.log(`   Sample row: ${JSON.stringify(data?.[0] || {})}`);
    return true;
  }
}

// Also set primary industry for test user (Eric)
async function setTestUserPrimaryIndustry() {
  console.log('\nSetting primary industry for eric@govcongiants.com to Construction...');

  const { data, error } = await supabase
    .from('user_notification_settings')
    .update({ primary_industry: 'Construction' })
    .eq('user_email', 'eric@govcongiants.com')
    .select('user_email, primary_industry, naics_codes');

  if (error) {
    console.log(`⚠️ Error updating: ${error.message}`);
    return;
  }

  console.log(`✅ Updated: ${JSON.stringify(data?.[0] || {})}`);
}

async function main() {
  const columnExists = await addPrimaryIndustryColumn();

  if (columnExists) {
    await setTestUserPrimaryIndustry();
  }

  console.log('\n--- Done ---');
}

main().catch(console.error);
