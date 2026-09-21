# BD Assist APIs

Complete API documentation for Pipeline and Teaming management in BD Assist.

## Database Schema

**Migration:** `supabase/migrations/20260410_pipeline_tracker.sql`

### Tables

1. **user_pipeline** - Opportunity tracking through capture stages
2. **pipeline_history** - Audit trail of stage changes (auto-populated by trigger)
3. **user_teaming_partners** - Saved teaming partners with contact info

---

## Pipeline API

**Base:** `/api/pipeline`

### GET - List Pipeline Opportunities

Retrieve all pipeline opportunities for a user, with optional filtering.

**Endpoint:** `GET /api/pipeline?email={email}&stage={stage}&priority={priority}&stats={boolean}`

**Query Parameters:**
- `email` (required) - User email address
- `stage` (optional) - Filter by stage: `tracking`, `pursuing`, `bidding`, `submitted`, `won`, `lost`, `archived`
- `priority` (optional) - Filter by priority: `low`, `medium`, `high`, `critical`
- `stats` (optional) - Include statistics in response (`true`/`false`)

**Example Request:**
```bash
curl "https://tools.govcongiants.org/api/pipeline?email=user@example.com&stats=true"
```

**Example Response:**
```json
{
  "opportunities": [
    {
      "id": "uuid-here",
      "user_email": "user@example.com",
      "notice_id": "abc123",
      "source": "sam.gov",
      "title": "IT Services Contract",
      "agency": "Department of Defense",
      "value_estimate": "$5M-$10M",
      "naics_code": "541512",
      "set_aside": "8(a)",
      "response_deadline": "2026-05-15T23:59:59Z",
      "stage": "pursuing",
      "win_probability": 65,
      "priority": "high",
      "notes": "Strong past performance match",
      "next_action": "Schedule capability demo",
      "next_action_date": "2026-04-15",
      "teaming_partners": ["Acme Corp", "Tech Solutions Inc"],
      "is_prime": true,
      "created_at": "2026-04-10T10:00:00Z",
      "updated_at": "2026-04-10T15:30:00Z"
    }
  ],
  "stats": {
    "total": 25,
    "active": 18,
    "byStage": {
      "tracking": 8,
      "pursuing": 6,
      "bidding": 3,
      "submitted": 1,
      "won": 4,
      "lost": 2,
      "archived": 1
    },
    "byPriority": {
      "low": 3,
      "medium": 12,
      "high": 8,
      "critical": 2
    },
    "estimatedPipelineValue": "$45.2M",
    "upcomingDeadlines": 4,
    "winRate": 67
  }
}
```

---

### POST - Add to Pipeline

Add a new opportunity to the user's pipeline.

**Endpoint:** `POST /api/pipeline`

**Request Body:**
```json
{
  "email": "user@example.com",
  "notice_id": "abc123",
  "source": "sam.gov",
  "external_url": "https://sam.gov/opp/abc123",
  "title": "IT Services Contract",
  "agency": "Department of Defense",
  "value_estimate": "$5M-$10M",
  "naics_code": "541512",
  "set_aside": "8(a)",
  "response_deadline": "2026-05-15T23:59:59Z",
  "stage": "tracking",
  "priority": "high",
  "notes": "Good fit for our capabilities",
  "teaming_partners": ["Partner Corp"],
  "is_prime": true
}
```

**Required Fields:**
- `email` - User email
- `title` - Opportunity title

**Optional Fields:**
- `notice_id` - SAM.gov notice ID (if from SAM)
- `source` - Source of opportunity (defaults to `manual`)
  - Options: `sam.gov`, `grants.gov`, `manual`
- `external_url` - Link to opportunity
- `agency` - Agency name
- `value_estimate` - Estimated contract value (text, e.g., "$5M-$10M")
- `naics_code` - NAICS code
- `set_aside` - Set-aside type
- `response_deadline` - ISO date string
- `stage` - Pipeline stage (defaults to `tracking`)
  - Options: `tracking`, `pursuing`, `bidding`, `submitted`, `won`, `lost`, `archived`
- `priority` - Priority level (defaults to `medium`)
  - Options: `low`, `medium`, `high`, `critical`
- `notes` - User notes
- `teaming_partners` - Array of partner company names
- `is_prime` - Boolean, whether user is prime contractor (defaults to `true`)

**Example Response:**
```json
{
  "success": true,
  "opportunity": { /* full opportunity object */ },
  "message": "Added to pipeline"
}
```

**Error Responses:**
- `400` - Missing required fields
- `409` - Opportunity already in pipeline (duplicate `notice_id`)
- `500` - Server error

---

### PATCH - Update Pipeline Opportunity

Update an existing pipeline opportunity.

**Endpoint:** `PATCH /api/pipeline`

**Request Body:**
```json
{
  "id": "uuid-of-opportunity",
  "email": "user@example.com",
  "stage": "bidding",
  "priority": "critical",
  "win_probability": 75,
  "notes": "Updated notes",
  "next_action": "Submit proposal",
  "next_action_date": "2026-05-10",
  "teaming_partners": ["Partner A", "Partner B"]
}
```

**Required Fields:**
- `id` - Opportunity UUID
- `email` - User email (for ownership verification)

**Updatable Fields:**
- `stage` - Pipeline stage
- `priority` - Priority level
- `win_probability` - 0-100
- `notes` - User notes
- `next_action` - Next action text
- `next_action_date` - Date string (YYYY-MM-DD)
- `teaming_partners` - Array of partner names
- `outcome_date` - Outcome date (for won/lost)
- `outcome_notes` - Outcome notes
- `award_amount` - Actual award amount (for won)

**Example Response:**
```json
{
  "success": true,
  "opportunity": { /* updated opportunity */ },
  "stageChanged": true
}
```

**Notes:**
- Stage changes are automatically logged to `pipeline_history` table via database trigger
- Ownership is verified before update (must match `user_email`)

---

### DELETE - Remove from Pipeline

Remove an opportunity from the pipeline.

**Endpoint:** `DELETE /api/pipeline`

**Request Body:**
```json
{
  "id": "uuid-of-opportunity",
  "email": "user@example.com"
}
```

**Required Fields:**
- `id` - Opportunity UUID
- `email` - User email (for ownership verification)

**Example Response:**
```json
{
  "success": true,
  "message": "Removed from pipeline"
}
```

---

## Pipeline Stats API

**Base:** `/api/pipeline/stats`

### GET - Get Pipeline Statistics

Get aggregated statistics for a user's pipeline.

**Endpoint:** `GET /api/pipeline/stats?email={email}`

**Query Parameters:**
- `email` (required) - User email address

**Example Request:**
```bash
curl "https://tools.govcongiants.org/api/pipeline/stats?email=user@example.com"
```

**Example Response:**
```json
{
  "totalCount": 25,
  "activeCount": 18,
  "byStage": {
    "tracking": 8,
    "pursuing": 6,
    "bidding": 3,
    "submitted": 1,
    "won": 4,
    "lost": 2,
    "archived": 1
  },
  "byPriority": {
    "low": 3,
    "medium": 12,
    "high": 8,
    "critical": 2
  },
  "totalValue": "$45.2M",
  "upcomingDeadlines": 4,
  "winRate": 67
}
```

**Field Descriptions:**
- `totalCount` - Total opportunities in pipeline
- `activeCount` - Opportunities not in `won`, `lost`, or `archived` stages
- `byStage` - Count by each stage
- `byPriority` - Count by each priority level
- `totalValue` - Sum of estimated contract values (parsed from `value_estimate`)
- `upcomingDeadlines` - Count with deadline in next 14 days
- `winRate` - Percentage: `won / (won + lost) * 100`

---

## Teaming API

**Base:** `/api/teaming`

### GET - List Saved Partners

Retrieve all saved teaming partners for a user.

**Endpoint:** `GET /api/teaming?email={email}&status={status}&type={type}`

**Query Parameters:**
- `email` (required) - User email address
- `status` (optional) - Filter by outreach status
  - Options: `none`, `contacted`, `responded`, `meeting`, `partnered`
- `type` (optional) - Filter by partner type
  - Options: `prime`, `sub`, `jv`, `mentor`

**Example Request:**
```bash
curl "https://tools.govcongiants.org/api/teaming?email=user@example.com&status=partnered"
```

**Example Response:**
```json
{
  "partners": [
    {
      "id": "uuid-here",
      "user_email": "user@example.com",
      "partner_name": "Acme Corporation",
      "partner_type": "sub",
      "uei": "ABC123456789",
      "cage_code": "1A2B3",
      "contact_name": "John Smith",
      "contact_email": "john@acme.com",
      "contact_phone": "(555) 123-4567",
      "contact_title": "Business Development Manager",
      "naics_codes": ["541512", "541519"],
      "certifications": ["8(a)", "EDWOSB"],
      "past_performance": "5 contracts with DOD",
      "outreach_status": "partnered",
      "last_contact": "2026-04-05",
      "notes": "Strong cybersecurity capabilities",
      "source": "contractor_db",
      "created_at": "2026-03-15T10:00:00Z",
      "updated_at": "2026-04-05T14:30:00Z"
    }
  ],
  "stats": {
    "total": 15,
    "byStatus": {
      "none": 3,
      "contacted": 5,
      "responded": 4,
      "meeting": 2,
      "partnered": 1
    },
    "byType": {
      "prime": 2,
      "sub": 10,
      "jv": 2,
      "mentor": 1
    }
  }
}
```

---

### POST - Save Teaming Partner

Save a new teaming partner.

**Endpoint:** `POST /api/teaming`

**Request Body:**
```json
{
  "email": "user@example.com",
  "partner_name": "Tech Solutions Inc",
  "partner_type": "sub",
  "uei": "XYZ987654321",
  "contact_name": "Jane Doe",
  "contact_email": "jane@techsolutions.com",
  "contact_phone": "(555) 987-6543",
  "naics_codes": ["541519", "541611"],
  "certifications": ["SDVOSB", "HUBZone"],
  "notes": "Met at conference, interested in teaming"
}
```

**Required Fields:**
- `email` - User email
- `partner_name` - Partner company name

**Optional Fields:**
- `partner_type` - Type of partnership
  - Options: `prime`, `sub`, `jv`, `mentor`
- `uei` - Unique Entity Identifier
- `cage_code` - CAGE code
- `contact_name` - Contact person name
- `contact_email` - Contact email
- `contact_phone` - Contact phone
- `contact_title` - Contact title
- `naics_codes` - Array of NAICS codes
- `certifications` - Array of certifications (e.g., `8(a)`, `WOSB`, `SDVOSB`, `HUBZone`)
- `past_performance` - Brief notes on past performance
- `outreach_status` - Defaults to `none`
- `notes` - User notes
- `source` - Defaults to `manual`

**Example Response:**
```json
{
  "success": true,
  "partner": { /* full partner object */ },
  "message": "Partner saved"
}
```

**Error Responses:**
- `400` - Missing required fields
- `409` - Partner already saved (duplicate `partner_name` for user)
- `500` - Server error

---

### PATCH - Update Teaming Partner

Update an existing teaming partner's information.

**Endpoint:** `PATCH /api/teaming`

**Request Body:**
```json
{
  "id": "uuid-of-partner",
  "email": "user@example.com",
  "outreach_status": "meeting",
  "contact_email": "newemail@partner.com",
  "notes": "Scheduled meeting for next week"
}
```

**Required Fields:**
- `id` - Partner UUID
- `email` - User email (for ownership verification)

**Updatable Fields:**
- `outreach_status` - Outreach status (auto-updates `last_contact` date)
- `last_contact` - Contact date (YYYY-MM-DD)
- `notes` - User notes
- `contact_name` - Contact person
- `contact_email` - Contact email
- `contact_phone` - Contact phone
- `contact_title` - Contact title
- `naics_codes` - Array of NAICS codes
- `certifications` - Array of certifications
- `past_performance` - Past performance notes

**Example Response:**
```json
{
  "success": true,
  "partner": { /* updated partner object */ }
}
```

**Notes:**
- When `outreach_status` changes to anything except `none`, `last_contact` is automatically set to today's date

---

### DELETE - Remove Teaming Partner

Remove a saved teaming partner.

**Endpoint:** `DELETE /api/teaming`

**Request Body:**
```json
{
  "id": "uuid-of-partner",
  "email": "user@example.com"
}
```

**Required Fields:**
- `id` - Partner UUID
- `email` - User email (for ownership verification)

**Example Response:**
```json
{
  "success": true,
  "message": "Partner removed"
}
```

---

## Error Handling

All endpoints follow consistent error response format:

```json
{
  "error": "Error message description"
}
```

**HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request (missing/invalid parameters)
- `404` - Not Found (resource doesn't exist or access denied)
- `409` - Conflict (duplicate entry)
- `500` - Internal Server Error

---

## Integration Examples

### JavaScript/TypeScript

```typescript
// Add to pipeline
const addToPipeline = async (opportunity: PipelineOpportunity) => {
  const response = await fetch('/api/pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opportunity)
  });
  return response.json();
};

// Get pipeline with stats
const getPipeline = async (email: string) => {
  const response = await fetch(`/api/pipeline?email=${email}&stats=true`);
  return response.json();
};

// Update stage
const updateStage = async (id: string, email: string, stage: string) => {
  const response = await fetch('/api/pipeline', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, email, stage })
  });
  return response.json();
};

// Save teaming partner
const savePartner = async (partner: TeamingPartner) => {
  const response = await fetch('/api/teaming', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partner)
  });
  return response.json();
};
```

### cURL Examples

```bash
# List pipeline
curl "https://tools.govcongiants.org/api/pipeline?email=user@example.com&stats=true"

# Add opportunity
curl -X POST "https://tools.govcongiants.org/api/pipeline" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "title": "Cybersecurity Services",
    "agency": "DHS",
    "stage": "tracking"
  }'

# Update stage
curl -X PATCH "https://tools.govcongiants.org/api/pipeline" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "uuid-here",
    "email": "user@example.com",
    "stage": "bidding"
  }'

# Get stats
curl "https://tools.govcongiants.org/api/pipeline/stats?email=user@example.com"

# Save teaming partner
curl -X POST "https://tools.govcongiants.org/api/teaming" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "partner_name": "Acme Corp",
    "partner_type": "sub"
  }'
```

---

## Database Triggers

**Auto-logging Stage Changes:**

When a pipeline opportunity's `stage` field changes, a trigger automatically inserts a record into `pipeline_history`:

```sql
CREATE TRIGGER track_pipeline_stage_changes
  AFTER UPDATE ON user_pipeline
  FOR EACH ROW
  EXECUTE FUNCTION record_pipeline_stage_change();
```

This provides an audit trail of all stage transitions for analytics and reporting.

---

## Testing

Run the database migration first:

```bash
# Apply migration to Supabase
supabase db push

# Or run SQL directly in Supabase Studio
```

Test with admin endpoints or local development server.

---

*Last Updated: April 10, 2026*
