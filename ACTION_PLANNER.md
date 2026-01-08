# 📋 GovCon Giants Action Planner

**2026 GovCon Action Plan Dashboard & Task Management System**

A comprehensive Next.js application for managing your government contracting action plan with progress tracking, task management, and resource library.

---

## 🚀 Overview

The GovCon Giants Action Planner is a task management system designed to help government contractors track their progress through the 2026 GovCon Action Plan. It provides a dashboard view, detailed phase pages, task management, and a resource library with bootcamp videos and templates.

### Key Features

- **📊 Progress Dashboard** - Visual progress tracking with circular progress indicators
- **✅ Task Management** - Detailed task tracking with checkboxes, notes, due dates, and attachments
- **📚 Resource Library** - Bootcamp videos, downloadable templates, and quick tips
- **📄 PDF Export** - Export phases or full plan as PDF documents
- **💾 Supabase Integration** - Persistent data storage with automatic seeding
- **📱 Responsive Design** - Mobile-friendly interface with Tailwind CSS

---

## 📁 Project Structure

```
src/app/planner/
├── page.tsx                    # Main dashboard with progress overview
├── phase/
│   └── [phaseId]/
│       └── page.tsx            # Individual phase detail page
└── resources/
    └── page.tsx                # Resources library (videos, templates, tips)

src/lib/
├── supabase/
│   ├── client.ts               # Supabase client configuration
│   ├── planner.ts              # Planner utility functions
│   └── planner-schema.sql     # Database schema
└── utils/
    └── exportPlan.ts           # PDF export functionality
```

---

## 🎯 The 5 Phases

The Action Plan is organized into 5 phases with 36 total tasks:

### Phase 1: Setup (12 tasks) - One-time setup
- Choose Business Structure
- DUNS and UEI
- Professional Email
- NAICS Code Identification
- SAM.gov Profile Creation
- DSBS Registration
- APEX Accelerator Consultation
- Capability Statement Creation

### Phase 2: Bidding (6 tasks) - Repeatable
- Review Immediate Bid Opportunities
- Find Bid Opportunities
- Assemble Team
- Apply for Vendor/Supplier Credit
- Respond to Opportunities (RFP, RFQ, RFI)
- Evaluate Bid Results

### Phase 3: Business Development (7 tasks) - Repeatable
- Identify Top 25 Buyers
- Setup Meetings with Government Buyers
- Attend Industry Events
- Attend Site Visits
- Get on Supplier Lists
- Monitor Contract Awards
- Track Long-term Contracts (IDIQ)

### Phase 4: Business Enhancement (7 tasks) - One-time
- Apply for Small Business Certifications
- 8(a) Certification
- Mentor Protégé Program
- Focus on Self-Performance Capability
- Find Better Partners
- Identify Mid-Size Mentor
- Speak at Events

### Phase 5: Contract Management (4 tasks) - Ongoing
- System Registrations (PIEE, WAWF)
- Subcontractor Compliance
- Project Compliance
- Communication

---

## 🛠️ Technology Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Database:** Supabase (PostgreSQL)
- **PDF Generation:** jsPDF
- **UI Components:** Custom components with shadcn/ui patterns

---

## 📦 Dependencies

### Core Dependencies
```json
{
  "next": "16.1.1",
  "react": "19.2.3",
  "react-dom": "19.2.3",
  "jspdf": "^2.x.x"
}
```

### Supabase
- `@supabase/supabase-js` - Supabase client library

---

## 🗄️ Database Schema

### `user_plans` Table

```sql
CREATE TABLE user_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  phase_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  notes TEXT,
  due_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, task_id)
);
```

**Indexes:**
- `idx_user_plans_user_id` on `user_id`
- `idx_user_plans_phase_id` on `phase_id`
- `idx_user_plans_user_phase` on `(user_id, phase_id)`
- `idx_user_plans_completed` on `completed`

**Row Level Security (RLS):**
- Users can only view/modify their own plans
- Policies enforce user isolation

---

## 🔧 Key Functions

### Supabase Utilities (`lib/supabase/planner.ts`)

#### `getUserProgress(userId: string): Promise<ProgressSummary>`
Fetches all user tasks and calculates overall and per-phase progress. Automatically seeds initial plan if user has no tasks.

**Returns:**
```typescript
{
  overall: number;           // Overall completion percentage
  totalTasks: number;        // Total tasks across all phases
  completedTasks: number;    // Number of completed tasks
  phases: PhaseProgress[];   // Per-phase progress breakdown
}
```

#### `updateTaskCompletion(userId, taskId, completed, notes?, dueDate?): Promise<UserTask>`
Updates task completion status with optional notes and due date. Uses optimistic UI updates.

#### `seedInitialPlan(userId: string): Promise<void>`
Seeds all 36 tasks from the 2026 Action Plan if user has no existing tasks.

#### `getPhaseTasks(userId, phaseId): Promise<UserTask[]>`
Fetches all tasks for a specific phase.

#### `getPhaseTasksWithDetails(userId, phaseId): Promise<Array<Task & { userTask?: UserTask }>>`
Gets tasks with merged seed data and user progress.

### PDF Export (`lib/utils/exportPlan.ts`)

#### `exportPhaseToPDF(phaseData: PhaseDataForExport): Promise<void>`
Generates a PDF for a single phase with:
- Header with GovCon Giants branding
- Phase title and progress summary
- Task list with checkboxes (checked if complete)
- Task descriptions, due dates, and notes
- Footer with "Powered by GovCon Giants"
- Automatic page breaks

#### `exportFullPlanToPDF(phases: PhaseDataForExport[], userName?): Promise<void>`
Generates a complete PDF with all phases, including table of contents.

---

## 🎨 UI Components

### Dashboard (`app/planner/page.tsx`)

**Features:**
- Circular progress indicator showing overall completion
- Motivational quote card
- Phase summary cards grid
- Collapsible sidebar with phase navigation
- User avatar dropdown (logout)

**Layout:**
- Top navbar with logo and user menu
- Hero section with progress ring
- Grid of phase cards (responsive: 1-3 columns)
- Sidebar with phase list (collapsible on mobile)

### Phase Detail Page (`app/planner/phase/[phaseId]/page.tsx`)

**Features:**
- Breadcrumb navigation
- Phase header with progress bar
- Accordion task list
- Task checkboxes with optimistic UI updates
- Due date pickers
- Notes textarea (auto-save)
- File attachment buttons (mock)
- Add custom task modal
- Export to PDF button

**Task Accordion Items:**
- Checkbox (blue when complete)
- Task title (bold, strikethrough when complete)
- Description
- Due date picker
- Notes textarea
- Attach file button
- Overdue badges (red)
- Complete badges (blue)

### Resources Page (`app/planner/resources/page.tsx`)

**Features:**
- Rotating motivational quotes (Eric Coffie)
- Embedded YouTube videos (bootcamp clips)
- Downloadable template links
- Quick tips cards grid (12 tips)
- Call-to-action section

**Sections:**
1. **Motivational Quotes** - Auto-rotating every 5 seconds
2. **Bootcamp Video Library** - 4 embedded YouTube videos
3. **Downloadable Templates** - 4 template cards with download links
4. **Quick Tips** - 12 tip cards in responsive grid

---

## 🔐 Authentication & Security

### Current Implementation
- Placeholder auth check (TODO: Add Supabase auth)
- Row Level Security (RLS) policies in Supabase
- User isolation enforced at database level

### To Implement
```typescript
// Add to phase pages
import { createClient } from '@/lib/supabase/client';
import { redirect } from 'next/navigation';

const supabase = createClient();
const { data: { session } } = await supabase.auth.getSession();

if (!session) {
  redirect('/login');
}
```

---

## 📝 Environment Variables

Required Supabase environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

---

## 🚀 Getting Started

### 1. Install Dependencies

```bash
cd market-assassin
npm install
```

### 2. Set Up Supabase

1. Create a Supabase project
2. Run the SQL schema from `lib/supabase/planner-schema.sql`
3. Add environment variables to `.env.local`

### 3. Run Development Server

```bash
npm run dev
```

### 4. Access the Planner

Navigate to `http://localhost:3000/planner`

---

## 📊 Data Flow

### Initial Load
1. User visits `/planner`
2. `getUserProgress()` is called
3. If no tasks exist, `seedInitialPlan()` creates all 36 tasks
4. Progress is calculated and displayed

### Task Updates
1. User checks/unchecks task
2. Optimistic UI update (immediate)
3. `updateTaskCompletion()` called
4. Supabase update
5. UI reflects final state

### PDF Export
1. User clicks "Export Phase as PDF"
2. Task data collected
3. `exportPhaseToPDF()` generates PDF client-side
4. PDF downloads automatically

---

## 🎯 Task ID Format

Tasks use the format: `{phaseId}-{order}`

Examples:
- `1-1` = Phase 1, Task 1
- `2-3` = Phase 2, Task 3
- `5-2` = Phase 5, Task 2

---

## 📚 Resources Integration

### YouTube Videos
Update video IDs in `app/planner/resources/page.tsx`:
```typescript
const bootcampVideos = [
  { id: 'YOUR_VIDEO_ID', title: '...', description: '...' },
  // ...
];
```

### Templates
Place PDF templates in `/public/templates/` and update paths:
```typescript
const templates = [
  { file: '/templates/capability-statement-template.pdf', ... },
  // ...
];
```

---

## 🔄 Future Enhancements

### Planned Features
- [ ] Full Supabase auth integration
- [ ] User profile management
- [ ] Email notifications for due dates
- [ ] Task reminders
- [ ] Team collaboration features
- [ ] Custom phase creation
- [ ] Task templates
- [ ] Analytics dashboard
- [ ] Mobile app (React Native)

### Improvements
- [ ] Add actual logo to PDF exports
- [ ] Real file upload for attachments
- [ ] Task dependencies
- [ ] Recurring tasks
- [ ] Task comments/activity log
- [ ] Export to Excel/CSV

---

## 🐛 Known Issues

1. **File Attachments** - Currently mock implementation, needs Supabase Storage integration
2. **User Name in PDF** - Placeholder, needs auth integration
3. **YouTube Video IDs** - Using placeholders, needs actual video IDs

---

## 📖 API Reference

### Supabase Functions

All functions are exported from `lib/supabase/planner.ts`:

```typescript
import {
  getUserProgress,
  updateTaskCompletion,
  seedInitialPlan,
  getPhaseTasks,
  getPhaseTasksWithDetails,
  getTaskDetails,
  getPhases,
  getPhaseSeedTasks,
} from '@/lib/supabase/planner';
```

### PDF Export Functions

```typescript
import {
  exportPhaseToPDF,
  exportFullPlanToPDF,
  type PhaseDataForExport,
  type TaskForExport,
} from '@/lib/utils/exportPlan';
```

---

## 🎨 Styling

### Color Scheme
- **Primary Blue:** `#1e40af` (used for headers, buttons, accents)
- **Background:** `gray-50`
- **Cards:** `white` with `gray-200` borders
- **Shadows:** Subtle `shadow-md` for depth

### Typography
- **Headings:** Bold, dark gray (`gray-900`)
- **Body:** Regular, medium gray (`gray-600`)
- **Small Text:** Light gray (`gray-500`)

### Components
- Cards use `rounded-lg` with `shadow-md`
- Buttons use primary blue with hover states
- Progress bars use blue fill
- Badges use colored backgrounds (red for overdue, blue for complete)

---

## 📞 Support

For questions about the Action Planner:
- Review this documentation
- Check the implementation in `src/app/planner/`
- Review Supabase utilities in `src/lib/supabase/planner.ts`

---

## 📄 License

Proprietary - All rights reserved

---

## 🏆 Credits

**Built by:** GovCon Giants Development Team  
**Action Plan:** Based on 2026 GovCon Action Plan  
**Quotes:** Eric Coffie

---

*Last Updated: December 2024*



