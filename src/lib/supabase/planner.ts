import { getPlannerSupabase as getSupabase } from './planner-client';

// TypeScript interfaces
export interface Phase {
  id: number;
  name: string;
  icon: string;
  order: number;
}

export interface VideoLesson {
  id: string;
  title: string;
  duration: string;
  vimeoId?: string;  // Vimeo video ID for embedding
  localPath?: string; // Local path for development
}

export interface Task {
  id: string;
  phaseId: number;
  title: string;
  description: string;
  order: number;
  priority?: 'high' | 'medium' | 'low';
  isCustom?: boolean;
  link?: string;
  videoLessons?: VideoLesson[];
}

export interface UserTask {
  id: string;
  userId: string;
  phaseId: number;
  taskId: string;
  completed: boolean;
  notes: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  priority?: 'high' | 'medium' | 'low';
  sortOrder?: number;
  isCustom?: boolean;
  title?: string;
  description?: string;
  link?: string;
}

export interface PhaseProgress {
  phaseId: number;
  phaseName: string;
  completed: number;
  total: number;
  progress: number; // percentage
}

export interface ProgressSummary {
  overall: number; // overall percentage
  totalTasks: number;
  completedTasks: number;
  phases: PhaseProgress[];
}

// Seed data for the 2026 GovCon Action Plan
const SEED_PHASES: Phase[] = [
  { id: 1, name: 'Setup', icon: '🏗️', order: 1 },
  { id: 2, name: 'Bidding', icon: '📝', order: 2 },
  { id: 3, name: 'Business Development', icon: '🚀', order: 3 },
  { id: 4, name: 'Business Enhancement', icon: '⭐', order: 4 },
  { id: 5, name: 'Contract Management', icon: '📋', order: 5 },
];

const SEED_TASKS: Omit<Task, 'id'>[] = [
  // Phase 1: Setup/Once (12 tasks)
  {
    phaseId: 1,
    title: 'Choose your Business Structure',
    description: 'Determine your business structure: Supplier v Service Provider v Consultant. This decision affects how you will be classified and what opportunities you can pursue.',
    order: 1,
    videoLessons: [
      { id: '1-01a', title: 'Why Structure Matters', duration: '1:15', vimeoId: '1176562094' },
      { id: '1-01b', title: 'Three Business Models', duration: '2:17', vimeoId: '1176562141' },
      { id: '1-01c', title: 'Making Your Choice', duration: '1:28', vimeoId: '1176562198' },
    ]
  },
  {
    phaseId: 1,
    title: 'DUNS and UEI',
    description: 'Obtain your DUNS number (if needed) and Unique Entity Identifier (UEI). The UEI is automatically assigned when you register in SAM.gov and replaces the DUNS number for federal contracts.',
    order: 2,
    videoLessons: [
      { id: '1-02a', title: 'What is a UEI?', duration: '1:10', vimeoId: '1176562243' },
      { id: '1-02b', title: 'How to Get Your UEI', duration: '1:25', vimeoId: '1176562284' },
    ]
  },
  {
    phaseId: 1,
    title: 'Creating Pro Email',
    description: 'Set up a professional email domain (e.g., yourname@yourcompany.com) rather than using free email services. This enhances credibility and professionalism when communicating with government agencies and prime contractors.',
    order: 3,
    videoLessons: [
      { id: '1-03a', title: 'Why Professional Email Matters', duration: '1:05', vimeoId: '1176562319' },
      { id: '1-03b', title: 'Setting Up Your Domain', duration: '1:20', vimeoId: '1176562359' },
      { id: '1-03c', title: 'Email Best Practices', duration: '1:08', vimeoId: '1176562410' },
    ]
  },
  {
    phaseId: 1,
    title: 'Identify your Industry codes (NAICS)',
    description: 'Identify the North American Industry Classification System (NAICS) codes that best represent your business capabilities. These codes determine which contracts you can pursue.',
    order: 4,
    videoLessons: [
      { id: '1-04a', title: 'What Are NAICS Codes?', duration: '1:18', vimeoId: '1176562448' },
      { id: '1-04b', title: 'Finding Your Codes', duration: '1:12', vimeoId: '1176562492' },
      { id: '1-04c', title: 'Strategic Code Selection', duration: '1:05', vimeoId: '1176562536' },
    ]
  },
  {
    phaseId: 1,
    title: 'How to Identify NAICS',
    description: 'Learn how to properly identify and select NAICS codes. Research which codes align with your services/products and which agencies use those codes most frequently.',
    order: 5,
    videoLessons: [
      { id: '1-09a', title: 'NAICS Research Tools', duration: '1:48', vimeoId: '1176563203' },
      { id: '1-09b', title: 'Selecting Your NAICS', duration: '1:59', vimeoId: '1176563262' },
    ]
  },
  {
    phaseId: 1,
    title: 'Create your SAM.GOV Profile',
    description: 'Complete your System for Award Management (SAM.gov) registration. This is the primary database for federal contractors and is required for all government contracting opportunities.',
    order: 6,
    videoLessons: [
      { id: '1-05a', title: 'SAM.gov Overview', duration: '0:55', vimeoId: '1176562590' },
      { id: '1-05b', title: 'Registration Requirements', duration: '0:58', vimeoId: '1176562620' },
      { id: '1-05c', title: 'Step-by-Step Registration', duration: '1:10', vimeoId: '1176562677' },
      { id: '1-05d', title: 'Maintaining Your Profile', duration: '0:55', vimeoId: '1176562734' },
    ]
  },
  {
    phaseId: 1,
    title: 'How to Create a SAM.gov Profile',
    description: 'Follow step-by-step instructions to create your SAM.gov profile with accurate business information, NAICS codes, and banking details.',
    order: 7,
    videoLessons: [
      { id: '1-10a', title: 'SAM.gov Pre-Registration', duration: '1:32', vimeoId: '1176563296' },
      { id: '1-10b', title: 'SAM.gov Registration Steps', duration: '2:10', vimeoId: '1176563338' },
      { id: '1-10c', title: 'Common SAM.gov Mistakes', duration: '1:56', vimeoId: '1176563397' },
    ]
  },
  {
    phaseId: 1,
    title: 'DSBS',
    description: 'Complete your Dynamic Small Business Search (DSBS) profile. This is the public-facing database that agencies use to find small businesses.',
    order: 8,
    videoLessons: [
      { id: '1-06a', title: 'What is DSBS?', duration: '1:00', vimeoId: '1176562805' },
      { id: '1-06b', title: 'Optimizing Your Profile', duration: '1:08', vimeoId: '1176562858' },
    ]
  },
  {
    phaseId: 1,
    title: 'Talk to Local Apex Accelerator',
    description: 'Contact your local APEX Accelerator (formerly PTAC) for free counseling and assistance with government contracting. They can help with registrations, certifications, and finding opportunities.',
    order: 9,
    videoLessons: [
      { id: '1-07a', title: 'Apex Accelerator Benefits', duration: '1:15', vimeoId: '1176562910' },
      { id: '1-07b', title: 'How to Connect', duration: '1:07', vimeoId: '1176562953' },
    ]
  },
  {
    phaseId: 1,
    title: 'Benefits / What to say to Apex Accelerator',
    description: 'Prepare for your APEX Accelerator meeting. Know what services they offer, what questions to ask, and how to make the most of their free resources and counseling.',
    order: 10,
    videoLessons: [
      { id: '1-11a', title: 'Apex Accelerator Services', duration: '1:39', vimeoId: '1176563464' },
      { id: '1-11b', title: 'What to Say to Your Apex', duration: '1:37', vimeoId: '1176563524' },
      { id: '1-11c', title: 'Building the Apex Relationship', duration: '1:41', vimeoId: '1176563588' },
    ]
  },
  {
    phaseId: 1,
    title: 'Create/ Fix your Business Resume (Cap Statement)',
    description: 'Create or update your Capability Statement. This one-page document highlights your company\'s core competencies, past performance, differentiators, and key personnel. Include what makes you unique based on bootcamp guidance.',
    order: 11,
    videoLessons: [
      { id: '1-08a', title: 'What is a Capability Statement?', duration: '0:55', vimeoId: '1176563003' },
      { id: '1-08b', title: 'The Core Sections', duration: '1:17', vimeoId: '1176563050' },
      { id: '1-08c', title: 'Your Differentiators', duration: '1:19', vimeoId: '1176563101' },
      { id: '1-08d', title: 'Design & Distribution', duration: '1:18', vimeoId: '1176563141' },
    ]
  },
  {
    phaseId: 1,
    title: 'What to put on Capability Statement / Clip from Bootcamp - differentiators',
    description: 'Learn what to include on your Capability Statement: core competencies, past performance examples, key personnel, certifications, and most importantly - your differentiators that set you apart from competitors.',
    order: 12,
    videoLessons: [
      { id: '1-12a', title: 'Capability Statement Essentials', duration: '2:15', vimeoId: '1176563643' },
      { id: '1-12b', title: 'Finding Your Differentiators', duration: '2:18', vimeoId: '1176563705' },
      { id: '1-12c', title: 'Design and Distribution', duration: '1:55', vimeoId: '1176563765' },
    ]
  },

  // Phase 2: Bidding/Repeat (6 tasks)
  {
    phaseId: 2,
    title: 'Review Immediate Bid Opportunities',
    description: 'Regularly review and identify immediate bid opportunities that match your capabilities and NAICS codes. Focus on opportunities with realistic win potential.',
    order: 1,
    videoLessons: [
      { id: '2-01a', title: 'Where to Find Opportunities', duration: '1:03', vimeoId: '1176570373' },
      { id: '2-01b', title: 'Understanding Opportunity Types', duration: '1:03', vimeoId: '1176570431' },
      { id: '2-01c', title: 'Search Strategies & Alerts', duration: '1:08', vimeoId: '1176570466' },
    ]
  },
  {
    phaseId: 2,
    title: 'How to Find Bid Opportunities',
    description: 'Learn where and how to find bid opportunities: SAM.gov, agency websites, forecast lists, industry days, and networking contacts. Set up alerts and monitoring systems.',
    order: 2,
    videoLessons: [
      { id: '2-01a', title: 'Where to Find Opportunities', duration: '1:03', vimeoId: '1176570373' },
      { id: '2-01b', title: 'Understanding Opportunity Types', duration: '1:03', vimeoId: '1176570431' },
      { id: '2-01c', title: 'Search Strategies & Alerts', duration: '1:08', vimeoId: '1176570466' },
    ]
  },
  {
    phaseId: 2,
    title: 'Assemble Team Based on Opportunities',
    description: 'Build your teaming and subcontracting strategy based on specific opportunities. Identify partners who complement your capabilities and fill gaps in your proposal.',
    order: 3,
    videoLessons: [
      { id: '2-02a', title: 'When to Team', duration: '0:57', vimeoId: '1176570591' },
      { id: '2-02b', title: 'Finding Partners', duration: '1:09', vimeoId: '1176570628' },
      { id: '2-02c', title: 'Teaming Agreements', duration: '1:26', vimeoId: '1176570674' },
    ]
  },
  {
    phaseId: 2,
    title: 'Apply for Vendor/ Supplier Credit',
    description: 'Establish vendor/supplier credit lines to support contract performance. Many contracts require you to purchase materials or services before receiving payment.',
    order: 4,
    videoLessons: [
      { id: '2-03a', title: 'Why Credit Matters', duration: '1:33', vimeoId: '1176570723' },
      { id: '2-03b', title: 'Building Business Credit', duration: '1:23', vimeoId: '1176570772' },
    ]
  },
  {
    phaseId: 2,
    title: 'Respond to Opportunity (RFP, RFQ, RFI, Task Orders)',
    description: 'Prepare and submit responses to Requests for Proposals (RFP), Requests for Quotations (RFQ), Requests for Information (RFI), and Task Orders. Follow all instructions carefully.',
    order: 5,
    videoLessons: [
      { id: '2-04a', title: 'Reading the RFP', duration: '1:27', vimeoId: '1176570824' },
      { id: '2-04b', title: 'Writing Your Proposal', duration: '1:25', vimeoId: '1176570864' },
      { id: '2-04c', title: 'Submission Checklist', duration: '1:19', vimeoId: '1176570907' },
    ]
  },
  {
    phaseId: 2,
    title: 'Evaluate Bid Results',
    description: 'After each bid submission, evaluate the results whether you win or lose. Learn from feedback, identify areas for improvement, and refine your approach for future opportunities.',
    order: 6,
    videoLessons: [
      { id: '2-05a', title: 'Tracking Award Results', duration: '1:13', vimeoId: '1176570961' },
      { id: '2-05b', title: 'Debriefings & Lessons Learned', duration: '1:23', vimeoId: '1176571021' },
    ]
  },

  // Phase 3: Business Development/Repeat (7 tasks)
  {
    phaseId: 3,
    title: 'Identify Top 25 Buyers & Future Bids (NOT ON SAM)',
    description: 'Research and identify your top 25 target buyers and future bid opportunities that may not be publicly listed on SAM.gov. Use agency forecasts, industry knowledge, and networking.',
    order: 1,
    videoLessons: [
      { id: '3-01a', title: 'Finding Your Top Buyers', duration: '1:10', vimeoId: '1176586665' },
      { id: '3-01b', title: 'Building Your Target Market List', duration: '1:11', vimeoId: '1176586718' },
      { id: '3-01c', title: 'Finding Opportunities Early', duration: '1:25', vimeoId: '1176586772' },
    ]
  },
  {
    phaseId: 3,
    title: 'Setup and attend meetings with government buyers',
    description: 'Schedule and attend meetings with government buyers, contracting officers, and program managers. Build relationships before opportunities are released.',
    order: 2,
    videoLessons: [
      { id: '3-02a', title: 'Finding Government Contacts', duration: '1:11', vimeoId: '1176586836' },
      { id: '3-02b', title: 'Reaching Out to Government', duration: '1:14', vimeoId: '1176586887' },
      { id: '3-02c', title: 'Capability Briefings', duration: '1:37', vimeoId: '1176586926' },
    ]
  },
  {
    phaseId: 3,
    title: 'Attend Industry Events',
    description: 'Attend industry events, trade shows, conferences, and networking functions to meet government buyers, prime contractors, and other small businesses.',
    order: 3,
    videoLessons: [
      { id: '3-03a', title: 'Finding Industry Events', duration: '1:34', vimeoId: '1176586972' },
      { id: '3-03b', title: 'Making Events Count', duration: '2:01', vimeoId: '1176587012' },
    ]
  },
  {
    phaseId: 3,
    title: 'Attend Site Visits',
    description: 'Attend agency site visits, industry days, and pre-solicitation conferences. These events provide valuable information about upcoming opportunities and agency needs.',
    order: 4,
    videoLessons: [
      { id: '3-04a', title: 'Understanding Site Visits', duration: '1:31', vimeoId: '1176587058' },
      { id: '3-04b', title: 'Preparing for Site Visits', duration: '1:57', vimeoId: '1176587108' },
    ]
  },
  {
    phaseId: 3,
    title: 'Get on Supplier List for top 25 Federal Suppliers',
    description: 'Register and get on the supplier lists for your top 25 federal suppliers (prime contractors). This positions you for subcontracting opportunities.',
    order: 5,
    videoLessons: [
      { id: '3-05a', title: 'Finding Prime Contractors', duration: '1:26', vimeoId: '1176587152' },
      { id: '3-05b', title: 'Getting on Supplier Lists', duration: '2:02', vimeoId: '1176587189' },
    ]
  },
  {
    phaseId: 3,
    title: 'Monitor Contract Awards and Identify Sub Opportunities',
    description: 'Monitor contract awards to identify subcontracting opportunities. Track which primes won contracts and reach out to offer your services as a subcontractor.',
    order: 6,
    videoLessons: [
      { id: '3-06a', title: 'Tracking Contract Awards', duration: '1:42', vimeoId: '1176587229' },
      { id: '3-06b', title: 'Understanding IDIQ Contracts', duration: '1:31', vimeoId: '1176587256' },
      { id: '3-06c', title: 'Finding Sub Opportunities', duration: '2:03', vimeoId: '1176587302' },
    ]
  },
  {
    phaseId: 3,
    title: 'Track long term contracts to bid (IDIQ)',
    description: 'Identify and track long-term contracts like Indefinite Delivery Indefinite Quantity (IDIQ) contracts. These provide ongoing opportunities to compete for task orders.',
    order: 7,
    videoLessons: [
      { id: '3-06b', title: 'Understanding IDIQ Contracts', duration: '1:31', vimeoId: '1176587256' },
      { id: '3-06c', title: 'Finding Sub Opportunities', duration: '2:03', vimeoId: '1176587302' },
    ]
  },

  // Phase 4: Business Enhancement/Once (7 tasks)
  {
    phaseId: 4,
    title: 'Apply for Small Business Certification',
    description: 'Apply for relevant small business certifications such as WOSB (Women-Owned Small Business), EDWOSB (Economically Disadvantaged WOSB), HUBZone, SDVOSB (Service-Disabled Veteran-Owned), or VOSB (Veteran-Owned Small Business).',
    order: 1,
    videoLessons: [
      { id: '4-01a', title: 'Understanding Certifications', duration: '1:52', vimeoId: '1176677253' },
      { id: '4-01b', title: 'Certification Application Process', duration: '2:07', vimeoId: '1176677301' },
    ]
  },
  {
    phaseId: 4,
    title: '8(a) Certification',
    description: 'If eligible, apply for the SBA 8(a) Business Development Program. This 9-year program provides access to sole-source and set-aside contracts.',
    order: 2,
    videoLessons: [
      { id: '4-02a', title: 'Understanding 8(a) Program', duration: '1:54', vimeoId: '1176677356' },
      { id: '4-02b', title: '8(a) Eligibility', duration: '1:42', vimeoId: '1176677398' },
    ]
  },
  {
    phaseId: 4,
    title: 'Mentor Protege Program',
    description: 'Participate in mentor-protege programs to gain experience, build capabilities, and access larger contracts through partnerships with established contractors.',
    order: 3,
    videoLessons: [
      { id: '4-03a', title: 'Mentor-Protégé Programs', duration: '1:45', vimeoId: '1176677441' },
      { id: '4-03b', title: 'Finding & Evaluating Mentors', duration: '1:48', vimeoId: '1176677479' },
    ]
  },
  {
    phaseId: 4,
    title: 'Focus on Self Performance Capability as Differentiator',
    description: 'Develop and highlight your self-performance capabilities as a key differentiator. Many agencies prefer contractors who can perform work directly rather than just manage subcontractors.',
    order: 4,
    videoLessons: [
      { id: '4-04a', title: 'Self-Performance Advantage', duration: '1:38', vimeoId: '1176677513' },
      { id: '4-04b', title: 'Building & Showcasing Self-Performance', duration: '1:52', vimeoId: '1176677567' },
    ]
  },
  {
    phaseId: 4,
    title: 'Find Better Partners',
    description: 'Continuously evaluate and improve your teaming and subcontracting partnerships. Seek partners who complement your capabilities and have strong past performance.',
    order: 5,
    videoLessons: [
      { id: '4-05a', title: 'Evaluating Current Partners', duration: '1:53', vimeoId: '1176677598' },
      { id: '4-05b', title: 'Finding Better Partners', duration: '1:46', vimeoId: '1176677631' },
    ]
  },
  {
    phaseId: 4,
    title: 'Identify Mid Size Mentor',
    description: 'Identify and establish relationships with mid-size companies that can serve as mentors. They can provide guidance, teaming opportunities, and help you navigate larger contracts.',
    order: 6,
    videoLessons: [
      { id: '4-06a', title: 'Mid-Size Mentor Benefits', duration: '2:04', vimeoId: '1176677668' },
      { id: '4-06b', title: 'Finding & Approaching Mid-Size Mentors', duration: '1:57', vimeoId: '1176677702' },
    ]
  },
  {
    phaseId: 4,
    title: 'Speak at an event',
    description: 'Position yourself as a subject matter expert by speaking at industry events, webinars, or conferences. This increases visibility and credibility with government buyers.',
    order: 7,
    videoLessons: [
      { id: '4-07a', title: 'Speaking Benefits', duration: '1:50', vimeoId: '1176677746' },
      { id: '4-07b', title: 'Topics & Proposals', duration: '1:46', vimeoId: '1176677795' },
    ]
  },

  // Phase 5: Contract Management (4 tasks)
  {
    phaseId: 5,
    title: 'System Registrations (PIEE, WAWF)',
    description: 'Register in required contract management systems: PIEE (Procurement Integrated Enterprise Environment) and WAWF (Wide Area Workflow) for invoicing and contract administration.',
    order: 1,
    videoLessons: [
      { id: '5-01a', title: 'Understanding PIEE & WAWF', duration: '1:37', vimeoId: '1176683587' },
      { id: '5-01b', title: 'Registration Process', duration: '1:46', vimeoId: '1176683650' },
    ]
  },
  {
    phaseId: 5,
    title: 'Subcontractor Compliance',
    description: 'Ensure subcontractor compliance with all contract requirements, including small business subcontracting plans, reporting, and performance standards.',
    order: 2,
    videoLessons: [
      { id: '5-02a', title: 'Subcontractor Compliance Basics', duration: '1:34', vimeoId: '1176683695' },
      { id: '5-02b', title: 'Managing & Reporting', duration: '1:46', vimeoId: '1176683738' },
    ]
  },
  {
    phaseId: 5,
    title: 'Project Compliance',
    description: 'Maintain compliance with all project requirements including technical specifications, quality standards, delivery schedules, and reporting obligations.',
    order: 3,
    videoLessons: [
      { id: '5-03a', title: 'Contract Compliance', duration: '1:54', vimeoId: '1176683780' },
      { id: '5-03b', title: 'Deliverable Management', duration: '1:52', vimeoId: '1176683831' },
    ]
  },
  {
    phaseId: 5,
    title: 'Communication',
    description: 'Establish clear communication protocols with contracting officers, program managers, and stakeholders. Regular communication prevents issues and builds strong relationships.',
    order: 4,
    videoLessons: [
      { id: '5-04a', title: 'Government Communication', duration: '1:44', vimeoId: '1176683865' },
      { id: '5-04b', title: 'Status Reporting & Issues', duration: '1:55', vimeoId: '1176683901' },
    ]
  },
];

/**
 * Get user progress summary including overall completion and per-phase progress
 */
export async function getUserProgress(userId: string): Promise<ProgressSummary> {
  const supabase = getSupabase();

  // If Supabase is not configured, return default progress with all tasks
  if (!supabase) {
    return getDefaultProgress();
  }

  try {
    // Fetch all user tasks
    const { data: userTasks, error } = await supabase
      .from('user_plans')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      console.error('Error fetching user progress:', error);
      throw error;
    }

    // If user has no tasks, seed initial plan
    if (!userTasks || userTasks.length === 0) {
      await seedInitialPlan(userId);
      // Fetch again after seeding
      const { data: seededTasks } = await supabase
        .from('user_plans')
        .select('*')
        .eq('user_id', userId);

      return calculateProgress(seededTasks || []);
    }

    return calculateProgress(userTasks);
  } catch (error) {
    console.error('Error in getUserProgress:', error);
    throw error;
  }
}

/**
 * Get default progress when Supabase is not configured
 */
function getDefaultProgress(): ProgressSummary {
  const phases: PhaseProgress[] = SEED_PHASES.map(phase => {
    const phaseTasks = SEED_TASKS.filter(t => t.phaseId === phase.id);
    return {
      phaseId: phase.id,
      phaseName: phase.name,
      completed: 0,
      total: phaseTasks.length,
      progress: 0,
    };
  });

  return {
    overall: 0,
    totalTasks: SEED_TASKS.length,
    completedTasks: 0,
    phases,
  };
}

/**
 * Calculate progress from user tasks
 */
function calculateProgress(userTasks: any[]): ProgressSummary {
  // Group tasks by phase
  const phaseMap = new Map<number, { completed: number; total: number; phaseName: string }>();

  // Initialize phases
  SEED_PHASES.forEach(phase => {
    phaseMap.set(phase.id, { completed: 0, total: 0, phaseName: phase.name });
  });

  // Count tasks per phase (includes both seed and custom tasks)
  userTasks.forEach(task => {
    const phase = phaseMap.get(task.phase_id);
    if (phase) {
      phase.total++;
      if (task.completed) {
        phase.completed++;
      }
    }
  });

  // Calculate overall progress
  let totalTasks = 0;
  let completedTasks = 0;
  const phases: PhaseProgress[] = [];

  phaseMap.forEach((stats, phaseId) => {
    totalTasks += stats.total;
    completedTasks += stats.completed;
    const progress = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
    phases.push({
      phaseId,
      phaseName: stats.phaseName,
      completed: stats.completed,
      total: stats.total,
      progress,
    });
  });

  const overall = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return {
    overall,
    totalTasks,
    completedTasks,
    phases: phases.sort((a, b) => a.phaseId - b.phaseId),
  };
}

/**
 * Update task completion status and optional notes/due date/priority/link
 */
export async function updateTaskCompletion(
  userId: string,
  taskId: string,
  completed: boolean,
  notes?: string,
  dueDate?: Date,
  priority?: 'high' | 'medium' | 'low',
  link?: string
): Promise<UserTask | null> {
  const supabase = getSupabase();

  // If Supabase is not configured, return null (updates won't persist)
  if (!supabase) {
    console.warn('Supabase not configured - task updates will not persist');
    return null;
  }

  try {
    // Determine if this is a custom task or a seed task
    const isCustomTask = taskId.includes('custom');

    if (!isCustomTask) {
      // Parse taskId (format: "phaseId-order")
      const [phaseIdStr, orderStr] = taskId.split('-');
      const phaseId = parseInt(phaseIdStr, 10);
      const order = parseInt(orderStr, 10);

      // Find the task in seed data
      const task = SEED_TASKS.find(t => t.phaseId === phaseId && t.order === order);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }
    }

    // Check if user_plan record exists
    const { data: existing } = await supabase
      .from('user_plans')
      .select('*')
      .eq('user_id', userId)
      .eq('task_id', taskId)
      .maybeSingle();

    const updateData: Record<string, unknown> = {
      completed,
      updated_at: new Date().toISOString(),
    };

    if (notes !== undefined) {
      updateData.notes = notes;
    }

    if (dueDate) {
      updateData.due_date = dueDate.toISOString();
    }

    if (priority !== undefined) {
      updateData.priority = priority;
    }

    if (link !== undefined) {
      updateData.link = link;
    }

    if (existing) {
      // Update existing record
      const { data, error } = await supabase
        .from('user_plans')
        .update(updateData)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      return data as UserTask;
    } else {
      // Parse phaseId from taskId
      const phaseId = parseInt(taskId.split('-')[0], 10);

      // Create new record
      const { data, error } = await supabase
        .from('user_plans')
        .insert({
          user_id: userId,
          phase_id: phaseId,
          task_id: taskId,
          completed,
          notes: notes || null,
          due_date: dueDate ? dueDate.toISOString() : null,
          priority: priority || 'medium',
          link: link || null,
          is_custom: isCustomTask,
        })
        .select()
        .single();

      if (error) throw error;
      return data as UserTask;
    }
  } catch (error) {
    console.error('Error updating task completion:', error);
    throw error;
  }
}

/**
 * Save a custom task to Supabase
 */
export async function saveCustomTask(
  userId: string,
  phaseId: number,
  title: string,
  description: string,
  dueDate?: string,
  priority?: 'high' | 'medium' | 'low'
): Promise<string> {
  const supabase = getSupabase();

  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  const taskId = `${phaseId}-custom-${Date.now()}`;

  try {
    const { error } = await supabase
      .from('user_plans')
      .insert({
        user_id: userId,
        phase_id: phaseId,
        task_id: taskId,
        completed: false,
        notes: null,
        due_date: dueDate || null,
        title,
        description,
        priority: priority || 'medium',
        is_custom: true,
        sort_order: 9999, // append to end
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (error) throw error;
    return taskId;
  } catch (error) {
    console.error('Error saving custom task:', error);
    throw error;
  }
}

/**
 * Delete a custom task (only works for is_custom=true tasks)
 */
export async function deleteCustomTask(userId: string, taskId: string): Promise<void> {
  const supabase = getSupabase();

  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    const { error } = await supabase
      .from('user_plans')
      .delete()
      .eq('user_id', userId)
      .eq('task_id', taskId)
      .eq('is_custom', true);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting custom task:', error);
    throw error;
  }
}

/**
 * Update task display order for a phase
 */
export async function updateTaskOrder(
  userId: string,
  phaseId: number,
  orderedTaskIds: string[]
): Promise<void> {
  const supabase = getSupabase();

  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    // Batch update sort_order for each task
    const updates = orderedTaskIds.map((taskId, index) =>
      supabase
        .from('user_plans')
        .update({ sort_order: index, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('task_id', taskId)
    );

    const results = await Promise.all(updates);
    const errors = results.filter(r => r.error);
    if (errors.length > 0) {
      console.error('Errors updating task order:', errors.map(e => e.error));
    }
  } catch (error) {
    console.error('Error updating task order:', error);
    throw error;
  }
}

/**
 * Bulk update all tasks in a phase
 */
export async function bulkUpdateTasks(
  userId: string,
  phaseId: number,
  updates: { completed?: boolean; notes?: string | null }
): Promise<void> {
  const supabase = getSupabase();

  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.completed !== undefined) {
      updateData.completed = updates.completed;
    }
    if (updates.notes !== undefined) {
      updateData.notes = updates.notes;
    }

    const { error } = await supabase
      .from('user_plans')
      .update(updateData)
      .eq('user_id', userId)
      .eq('phase_id', phaseId);

    if (error) throw error;
  } catch (error) {
    console.error('Error bulk updating tasks:', error);
    throw error;
  }
}

/**
 * Seed initial plan data for a user if they have none
 */
export async function seedInitialPlan(userId: string): Promise<void> {
  const supabase = getSupabase();

  // If Supabase is not configured, skip seeding
  if (!supabase) {
    return;
  }

  try {
    // Check if user already has tasks
    const { data: existing } = await supabase
      .from('user_plans')
      .select('id')
      .eq('user_id', userId)
      .limit(1);

    if (existing && existing.length > 0) {
      // User already has tasks, don't seed
      return;
    }

    // Insert all tasks for all phases
    const userPlans = SEED_TASKS.map((task, index) => {
      // Generate a unique task_id (could be phaseId-order or a UUID)
      const taskId = `${task.phaseId}-${task.order}`;

      return {
        user_id: userId,
        phase_id: task.phaseId,
        task_id: taskId,
        completed: false,
        notes: null,
        due_date: null,
        priority: 'medium',
        sort_order: index,
        is_custom: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });

    const { error } = await supabase
      .from('user_plans')
      .insert(userPlans);

    if (error) {
      console.error('Error seeding initial plan:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error in seedInitialPlan:', error);
    throw error;
  }
}

/**
 * Get all tasks for a specific phase
 */
export async function getPhaseTasks(userId: string, phaseId: number): Promise<UserTask[]> {
  const supabase = getSupabase();

  // If Supabase is not configured, return empty array
  if (!supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('user_plans')
      .select('*')
      .eq('user_id', userId)
      .eq('phase_id', phaseId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data || []) as UserTask[];
  } catch (error) {
    console.error('Error fetching phase tasks:', error);
    throw error;
  }
}

/**
 * Get task details including seed task information
 */
export function getTaskDetails(taskId: string): Task | null {
  const parts = taskId.split('-');
  if (parts.length !== 2) return null;

  const phaseId = parseInt(parts[0], 10);
  const order = parseInt(parts[1], 10);

  if (isNaN(phaseId) || isNaN(order)) return null;

  const task = SEED_TASKS.find(t => t.phaseId === phaseId && t.order === order);

  if (!task) return null;

  return {
    id: taskId,
    ...task,
  };
}

/**
 * Get all tasks for a phase with merged seed data and user progress
 * Now also returns custom tasks from the database
 */
export async function getPhaseTasksWithDetails(userId: string, phaseId: number): Promise<Array<Task & { userTask?: UserTask }>> {
  try {
    // Get user tasks for this phase
    const userTasks = await getPhaseTasks(userId, phaseId);
    const userTaskMap = new Map(userTasks.map(ut => [ut.taskId, ut]));

    // Get seed tasks for this phase
    const seedTasks = getPhaseSeedTasks(phaseId);

    // Merge seed tasks with user progress
    const mergedTasks: Array<Task & { userTask?: UserTask }> = seedTasks.map(seedTask => ({
      ...seedTask,
      priority: (userTaskMap.get(seedTask.id) as any)?.priority || 'medium',
      link: (userTaskMap.get(seedTask.id) as any)?.link || undefined,
      userTask: userTaskMap.get(seedTask.id),
    }));

    // Add custom tasks from DB
    const customUserTasks = userTasks.filter(ut => ut.isCustom || (ut as any).is_custom);
    customUserTasks.forEach(customUt => {
      mergedTasks.push({
        id: customUt.taskId,
        phaseId,
        title: (customUt as any).title || customUt.taskId,
        description: (customUt as any).description || '',
        order: (customUt as any).sort_order ?? 9999,
        priority: (customUt as any).priority || 'medium',
        isCustom: true,
        link: (customUt as any).link || undefined,
        userTask: customUt,
      });
    });

    // Sort by sort_order from DB if available, then by original order
    mergedTasks.sort((a, b) => {
      const aOrder = (a.userTask as any)?.sort_order ?? a.order;
      const bOrder = (b.userTask as any)?.sort_order ?? b.order;
      return aOrder - bOrder;
    });

    return mergedTasks;
  } catch (error) {
    console.error('Error fetching phase tasks with details:', error);
    throw error;
  }
}

/**
 * Get all seed phases
 */
export function getPhases(): Phase[] {
  return SEED_PHASES;
}

/**
 * Get all seed tasks for a phase
 */
export function getPhaseSeedTasks(phaseId: number): Task[] {
  return SEED_TASKS
    .filter(t => t.phaseId === phaseId)
    .map((t) => ({
      id: `${t.phaseId}-${t.order}`,
      ...t,
    }));
}
