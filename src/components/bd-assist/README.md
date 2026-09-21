# BD Assist Components

Business development pipeline tracking and opportunity management components.

## Components

### PipelineBoard

Main kanban-style board showing opportunities grouped by stage.

**Props:**
```typescript
interface PipelineBoardProps {
  email: string; // User email to load their pipeline
}
```

**Usage:**
```tsx
import { PipelineBoard } from '@/components/bd-assist';

export default function PipelinePage() {
  return (
    <div className="container mx-auto p-6">
      <PipelineBoard email="user@example.com" />
    </div>
  );
}
```

**Features:**
- Kanban board with 6 stages: Tracking, Pursuing, Bidding, Submitted, Won, Lost
- Drag-and-drop style stage progression (← Prev / Next → buttons)
- Add new opportunities via modal
- Edit/delete existing opportunities
- Empty state with call-to-action
- Real-time count badges
- Responsive grid layout (1-6 columns based on screen size)

---

### PipelineCard

Individual opportunity card displayed within stage columns.

**Props:**
```typescript
interface PipelineCardProps {
  item: {
    id: string;
    title: string;
    agency?: string;
    value_estimate?: string;
    response_deadline?: string;
    stage: string;
    priority?: string;
    win_probability?: number;
    notice_id?: string;
    source?: string;
  };
  onStageChange: (id: string, newStage: string) => void;
  onEdit: (id: string) => void;
  onDelete?: (id: string) => void;
}
```

**Features:**
- Priority badges (critical, high, medium, low) with color coding
- Urgency indicators based on deadline:
  - 🔥 X DAYS LEFT (red, highlighted) - 3 days or less
  - ⚡ X days (orange) - 4-7 days
  - 📅 X days (yellow) - 8-14 days
  - Gray badge - 15+ days
  - OVERDUE (red) - past deadline
- Win probability progress bar
- Source badges (SAM.gov, grants.gov, manual)
- Hover actions: ← Prev | Next → | 🗑
- Click to edit

---

### PipelineModal

Add/edit opportunity modal form.

**Props:**
```typescript
interface PipelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: PipelineFormData) => Promise<void>;
  initialData?: PipelineFormData | null;
  email: string;
}

interface PipelineFormData {
  id?: string;
  title: string;
  agency?: string;
  value_estimate?: string;
  naics_code?: string;
  set_aside?: string;
  response_deadline?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  win_probability?: number;
  notes?: string;
  source?: string;
  external_url?: string;
  teaming_partners?: string;
  stage?: string;
}
```

**Form Fields:**
- Title (required)
- Agency
- Value Estimate
- NAICS Code
- Set-Aside (dropdown: 8(a), SDVOSB, WOSB, HUBZone, SB, Unrestricted)
- Response Deadline (date picker)
- Priority (dropdown: low, medium, high, critical)
- Stage (dropdown: tracking, pursuing, bidding, submitted, won, lost)
- Win Probability (0-100% slider)
- External URL
- Teaming Partners (comma-separated)
- Notes (textarea)

**Features:**
- Client-side validation
- Loading states
- Error handling
- Auto-fill for editing
- Scrollable content area

---

## API Integration

All components use the `/api/pipeline` endpoint:

### GET `/api/pipeline?email={email}`
Load user's pipeline opportunities.

**Query Parameters:**
- `email` (required) - User email
- `stage` (optional) - Filter by stage
- `priority` (optional) - Filter by priority
- `stats=true` (optional) - Include pipeline statistics

**Response:**
```json
{
  "opportunities": [...],
  "stats": {
    "total": 15,
    "active": 12,
    "byStage": { "tracking": 5, "pursuing": 3, ... },
    "byPriority": { "high": 4, "medium": 8, ... },
    "estimatedPipelineValue": "$25.5M",
    "upcomingDeadlines": 3,
    "winRate": 67
  }
}
```

### POST `/api/pipeline`
Add opportunity to pipeline.

**Body:**
```json
{
  "user_email": "user@example.com",
  "title": "Cyber Defense Services",
  "agency": "DOD",
  "value_estimate": "$5M-$10M",
  "naics_code": "541512",
  "set_aside": "8(a)",
  "response_deadline": "2026-05-15",
  "priority": "high",
  "win_probability": 75,
  "stage": "pursuing"
}
```

### PATCH `/api/pipeline`
Update pipeline opportunity.

**Body:**
```json
{
  "id": "uuid",
  "user_email": "user@example.com",
  "stage": "bidding",
  "win_probability": 80
}
```

### DELETE `/api/pipeline`
Remove opportunity from pipeline.

**Body:**
```json
{
  "id": "uuid",
  "user_email": "user@example.com"
}
```

---

## Database Schema

Requires `user_pipeline` table (see Supabase migration).

```sql
CREATE TABLE user_pipeline (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_email TEXT NOT NULL,
  notice_id TEXT,
  source TEXT DEFAULT 'manual',
  external_url TEXT,
  title TEXT NOT NULL,
  agency TEXT,
  value_estimate TEXT,
  naics_code TEXT,
  set_aside TEXT,
  response_deadline TIMESTAMPTZ,
  stage TEXT DEFAULT 'tracking',
  win_probability INTEGER,
  priority TEXT DEFAULT 'medium',
  notes TEXT,
  next_action TEXT,
  next_action_date TIMESTAMPTZ,
  teaming_partners TEXT[],
  is_prime BOOLEAN DEFAULT true,
  outcome_date TIMESTAMPTZ,
  outcome_notes TEXT,
  award_amount TEXT,
  winner TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Stage Colors

| Stage | Background | Use Case |
|-------|-----------|----------|
| Tracking | Gray | Initial awareness, monitoring |
| Pursuing | Blue | Active pursuit, research, teaming |
| Bidding | Yellow | Proposal development in progress |
| Submitted | Purple | Proposal submitted, awaiting decision |
| Won | Green | Contract awarded to you |
| Lost | Red | Lost to competitor or not selected |

---

## Priority Colors

| Priority | Badge Style | Use Case |
|----------|------------|----------|
| Critical | Red border + bg | Must-win, strategic priority |
| High | Red text + light bg | Important opportunity |
| Medium | Yellow text + light bg | Standard pursuit |
| Low | Gray text + light bg | Watch/monitor only |

---

## Example Page Implementation

```tsx
// app/bd-assist/pipeline/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { PipelineBoard } from '@/components/bd-assist';

export default function PipelinePage() {
  const [userEmail, setUserEmail] = useState<string>('');

  useEffect(() => {
    // Get email from auth, cookies, or session
    const email = localStorage.getItem('user_email') || '';
    setUserEmail(email);
  }, []);

  if (!userEmail) {
    return (
      <div className="container mx-auto p-6 text-center">
        <p className="text-gray-600">Please log in to view your pipeline.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">BD Pipeline</h1>
          <p className="text-gray-600 mt-2">
            Track your opportunities from initial awareness through to win or loss.
          </p>
        </div>

        <PipelineBoard email={userEmail} />
      </div>
    </div>
  );
}
```

---

## Styling

All components use Tailwind CSS classes. No external CSS required.

**Colors used:**
- Blue: Primary actions (bg-blue-600, bg-blue-100)
- Gray: Neutral states (bg-gray-50, bg-gray-200)
- Yellow: Bidding stage, medium priority (bg-yellow-500)
- Purple: Submitted stage (bg-purple-100)
- Green: Won stage, success states (bg-green-500)
- Red: Lost stage, urgent deadlines, critical priority (bg-red-600)

---

## Future Enhancements

- Drag-and-drop between columns
- Bulk operations (archive, export)
- Pipeline value charts
- Win/loss analytics
- Automated capture from SAM.gov/Grants.gov
- Email notifications for approaching deadlines
- Team collaboration features
- Custom stages/workflows
- Integration with Federal Market Assassin reports
