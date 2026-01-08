import { getSupabase } from './client';

// TypeScript interfaces
export interface Phase {
  id: number;
  name: string;
  icon: string;
  order: number;
}

export interface Task {
  id: string;
  phaseId: number;
  title: string;
  description: string;
  order: number;
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
  // Phase 1: Setup/Once (10 tasks)
  { phaseId: 1, title: 'Choose your Business Structure', description: 'Determine your business structure: Supplier v Service Provider v Consultant. This decision affects how you will be classified and what opportunities you can pursue.', order: 1 },
  { phaseId: 1, title: 'DUNS and UEI', description: 'Obtain your DUNS number (if needed) and Unique Entity Identifier (UEI). The UEI is automatically assigned when you register in SAM.gov and replaces the DUNS number for federal contracts.', order: 2 },
  { phaseId: 1, title: 'Creating Pro Email', description: 'Set up a professional email domain (e.g., yourname@yourcompany.com) rather than using free email services. This enhances credibility and professionalism when communicating with government agencies and prime contractors.', order: 3 },
  { phaseId: 1, title: 'Identify your Industry codes (NAICS)', description: 'Identify the North American Industry Classification System (NAICS) codes that best represent your business capabilities. These codes determine which contracts you can pursue.', order: 4 },
  { phaseId: 1, title: 'How to Identify NAICS', description: 'Learn how to properly identify and select NAICS codes. Research which codes align with your services/products and which agencies use those codes most frequently.', order: 5 },
  { phaseId: 1, title: 'Create your SAM.GOV Profile', description: 'Complete your System for Award Management (SAM.gov) registration. This is the primary database for federal contractors and is required for all government contracting opportunities.', order: 6 },
  { phaseId: 1, title: 'How to Create a SAM.gov Profile', description: 'Follow step-by-step instructions to create your SAM.gov profile with accurate business information, NAICS codes, and banking details.', order: 7 },
  { phaseId: 1, title: 'DSBS', description: 'Complete your Dynamic Small Business Search (DSBS) profile. This is the public-facing database that agencies use to find small businesses.', order: 8 },
  { phaseId: 1, title: 'Talk to Local Apex Accelerator', description: 'Contact your local APEX Accelerator (formerly PTAC) for free counseling and assistance with government contracting. They can help with registrations, certifications, and finding opportunities.', order: 9 },
  { phaseId: 1, title: 'Benefits / What to say to Apex Accelerator', description: 'Prepare for your APEX Accelerator meeting. Know what services they offer, what questions to ask, and how to make the most of their free resources and counseling.', order: 10 },
  { phaseId: 1, title: 'Create/ Fix your Business Resume (Cap Statement)', description: 'Create or update your Capability Statement. This one-page document highlights your company\'s core competencies, past performance, differentiators, and key personnel. Include what makes you unique based on bootcamp guidance.', order: 11 },
  { phaseId: 1, title: 'What to put on Capability Statement / Clip from Bootcamp - differentiators', description: 'Learn what to include on your Capability Statement: core competencies, past performance examples, key personnel, certifications, and most importantly - your differentiators that set you apart from competitors.', order: 12 },
  
  // Phase 2: Bidding/Repeat (6 tasks)
  { phaseId: 2, title: 'Review Immediate Bid Opportunities', description: 'Regularly review and identify immediate bid opportunities that match your capabilities and NAICS codes. Focus on opportunities with realistic win potential.', order: 1 },
  { phaseId: 2, title: 'How to Find Bid Opportunities', description: 'Learn where and how to find bid opportunities: SAM.gov, agency websites, forecast lists, industry days, and networking contacts. Set up alerts and monitoring systems.', order: 2 },
  { phaseId: 2, title: 'Assemble Team Based on Opportunities', description: 'Build your teaming and subcontracting strategy based on specific opportunities. Identify partners who complement your capabilities and fill gaps in your proposal.', order: 3 },
  { phaseId: 2, title: 'Apply for Vendor/ Supplier Credit', description: 'Establish vendor/supplier credit lines to support contract performance. Many contracts require you to purchase materials or services before receiving payment.', order: 4 },
  { phaseId: 2, title: 'Respond to Opportunity (RFP, RFQ, RFI, Task Orders)', description: 'Prepare and submit responses to Requests for Proposals (RFP), Requests for Quotations (RFQ), Requests for Information (RFI), and Task Orders. Follow all instructions carefully.', order: 5 },
  { phaseId: 2, title: 'Evaluate Bid Results', description: 'After each bid submission, evaluate the results whether you win or lose. Learn from feedback, identify areas for improvement, and refine your approach for future opportunities.', order: 6 },
  
  // Phase 3: Business Development/Repeat (7 tasks)
  { phaseId: 3, title: 'Identify Top 25 Buyers & Future Bids (NOT ON SAM)', description: 'Research and identify your top 25 target buyers and future bid opportunities that may not be publicly listed on SAM.gov. Use agency forecasts, industry knowledge, and networking.', order: 1 },
  { phaseId: 3, title: 'Setup and attend meetings with government buyers', description: 'Schedule and attend meetings with government buyers, contracting officers, and program managers. Build relationships before opportunities are released.', order: 2 },
  { phaseId: 3, title: 'Attend Industry Events', description: 'Attend industry events, trade shows, conferences, and networking functions to meet government buyers, prime contractors, and other small businesses.', order: 3 },
  { phaseId: 3, title: 'Attend Site Visits', description: 'Attend agency site visits, industry days, and pre-solicitation conferences. These events provide valuable information about upcoming opportunities and agency needs.', order: 4 },
  { phaseId: 3, title: 'Get on Supplier List for top 25 Federal Suppliers', description: 'Register and get on the supplier lists for your top 25 federal suppliers (prime contractors). This positions you for subcontracting opportunities.', order: 5 },
  { phaseId: 3, title: 'Monitor Contract Awards and Identify Sub Opportunities', description: 'Monitor contract awards to identify subcontracting opportunities. Track which primes won contracts and reach out to offer your services as a subcontractor.', order: 6 },
  { phaseId: 3, title: 'Track long term contracts to bid (IDIQ)', description: 'Identify and track long-term contracts like Indefinite Delivery Indefinite Quantity (IDIQ) contracts. These provide ongoing opportunities to compete for task orders.', order: 7 },
  
  // Phase 4: Business Enhancement/Once (7 tasks)
  { phaseId: 4, title: 'Apply for Small Business Certification', description: 'Apply for relevant small business certifications such as WOSB (Women-Owned Small Business), EDWOSB (Economically Disadvantaged WOSB), HUBZone, SDVOSB (Service-Disabled Veteran-Owned), or VOSB (Veteran-Owned Small Business).', order: 1 },
  { phaseId: 4, title: '8(a) Certification', description: 'If eligible, apply for the SBA 8(a) Business Development Program. This 9-year program provides access to sole-source and set-aside contracts.', order: 2 },
  { phaseId: 4, title: 'Mentor Protege Program', description: 'Participate in mentor-protégé programs to gain experience, build capabilities, and access larger contracts through partnerships with established contractors.', order: 3 },
  { phaseId: 4, title: 'Focus on Self Performance Capability as Differentiator', description: 'Develop and highlight your self-performance capabilities as a key differentiator. Many agencies prefer contractors who can perform work directly rather than just manage subcontractors.', order: 4 },
  { phaseId: 4, title: 'Find Better Partners', description: 'Continuously evaluate and improve your teaming and subcontracting partnerships. Seek partners who complement your capabilities and have strong past performance.', order: 5 },
  { phaseId: 4, title: 'Identify Mid Size Mentor', description: 'Identify and establish relationships with mid-size companies that can serve as mentors. They can provide guidance, teaming opportunities, and help you navigate larger contracts.', order: 6 },
  { phaseId: 4, title: 'Speak at an event', description: 'Position yourself as a subject matter expert by speaking at industry events, webinars, or conferences. This increases visibility and credibility with government buyers.', order: 7 },
  
  // Phase 5: Contract Management (4 tasks)
  { phaseId: 5, title: 'System Registrations (PIEE, WAWF)', description: 'Register in required contract management systems: PIEE (Procurement Integrated Enterprise Environment) and WAWF (Wide Area Workflow) for invoicing and contract administration.', order: 1 },
  { phaseId: 5, title: 'Subcontractor Compliance', description: 'Ensure subcontractor compliance with all contract requirements, including small business subcontracting plans, reporting, and performance standards.', order: 2 },
  { phaseId: 5, title: 'Project Compliance', description: 'Maintain compliance with all project requirements including technical specifications, quality standards, delivery schedules, and reporting obligations.', order: 3 },
  { phaseId: 5, title: 'Communication', description: 'Establish clear communication protocols with contracting officers, program managers, and stakeholders. Regular communication prevents issues and builds strong relationships.', order: 4 },
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

  // Count tasks per phase
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
 * Update task completion status and optional notes/due date
 */
export async function updateTaskCompletion(
  userId: string,
  taskId: string,
  completed: boolean,
  notes?: string,
  dueDate?: Date
): Promise<UserTask | null> {
  const supabase = getSupabase();

  // If Supabase is not configured, return null (updates won't persist)
  if (!supabase) {
    console.warn('Supabase not configured - task updates will not persist');
    return null;
  }

  try {
    // Parse taskId (format: "phaseId-order")
    const [phaseIdStr, orderStr] = taskId.split('-');
    const phaseId = parseInt(phaseIdStr, 10);
    const order = parseInt(orderStr, 10);

    // Find the task in seed data
    const task = SEED_TASKS.find(t => t.phaseId === phaseId && t.order === order);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
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
      // Create new record
      const { data, error } = await supabase
        .from('user_plans')
        .insert({
          user_id: userId,
          phase_id: task.phaseId,
          task_id: taskId,
          completed,
          notes: notes || null,
          due_date: dueDate ? dueDate.toISOString() : null,
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
    const userPlans = SEED_TASKS.map((task) => {
      // Generate a unique task_id (could be phaseId-order or a UUID)
      const taskId = `${task.phaseId}-${task.order}`;

      return {
        user_id: userId,
        phase_id: task.phaseId,
        task_id: taskId,
        completed: false,
        notes: null,
        due_date: null,
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
 */
export async function getPhaseTasksWithDetails(userId: string, phaseId: number): Promise<Array<Task & { userTask?: UserTask }>> {
  try {
    // Get user tasks for this phase
    const userTasks = await getPhaseTasks(userId, phaseId);
    const userTaskMap = new Map(userTasks.map(ut => [ut.taskId, ut]));
    
    // Get seed tasks for this phase
    const seedTasks = getPhaseSeedTasks(phaseId);
    
    // Merge seed tasks with user progress
    return seedTasks.map(seedTask => ({
      ...seedTask,
      userTask: userTaskMap.get(seedTask.id),
    }));
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
    .map((t, index) => ({
      id: `${t.phaseId}-${t.order}`,
      ...t,
    }));
}

