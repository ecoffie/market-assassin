'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { exportPhaseToPDF, type PhaseDataForExport } from '@/lib/utils/exportPlan';
import {
  getPhaseTasksWithDetails,
  updateTaskCompletion,
  getPhaseSeedTasks,
} from '@/lib/supabase/planner';
import { useAuth } from '@/lib/supabase/AuthContext';

// Phase data mapping
const phaseDataMap: Record<string, { id: number; name: string; icon: string }> = {
  '1': { id: 1, name: 'Setup', icon: '🏗️' },
  'setup': { id: 1, name: 'Setup', icon: '🏗️' },
  '2': { id: 2, name: 'Bidding', icon: '📝' },
  'bidding': { id: 2, name: 'Bidding', icon: '📝' },
  '3': { id: 3, name: 'Business Development', icon: '🚀' },
  'business-development': { id: 3, name: 'Business Development', icon: '🚀' },
  '4': { id: 4, name: 'Business Enhancement', icon: '⭐' },
  'business-enhancement': { id: 4, name: 'Business Enhancement', icon: '⭐' },
  '5': { id: 5, name: 'Contract Management', icon: '📋' },
  'contract-management': { id: 5, name: 'Contract Management', icon: '📋' },
};

// Task interface for display
interface Task {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  dueDate?: string;
  notes: string;
  attachments: string[];
}

// Accordion Item Component
function AccordionItem({
  task,
  onUpdate,
  userId
}: {
  task: Task;
  onUpdate: (updatedTask: Task) => void;
  userId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [localTask, setLocalTask] = useState(task);
  const [isSaving, setIsSaving] = useState(false);

  // Update local task when prop changes
  useEffect(() => {
    setLocalTask(task);
  }, [task]);

  const isOverdue = localTask.dueDate && !localTask.completed && new Date(localTask.dueDate) < new Date();

  const handleCheckboxChange = async (checked: boolean) => {
    // Optimistic UI update
    const updatedTask = { ...localTask, completed: checked };
    setLocalTask(updatedTask);
    setIsSaving(true);

    try {
      // Save to Supabase
      await updateTaskCompletion(
        userId,
        localTask.id,
        checked,
        localTask.notes || undefined,
        localTask.dueDate ? new Date(localTask.dueDate) : undefined
      );

      onUpdate(updatedTask);
    } catch (error) {
      // Revert on error
      setLocalTask(localTask);
      console.error('Failed to update task:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleFieldUpdate = async (field: keyof Task, value: string | string[]) => {
    const updatedTask = { ...localTask, [field]: value };
    setLocalTask(updatedTask);

    // Auto-save notes and due date to Supabase
    if (field === 'notes' || field === 'dueDate') {
      try {
        await updateTaskCompletion(
          userId,
          localTask.id,
          localTask.completed,
          field === 'notes' ? value as string : localTask.notes || undefined,
          field === 'dueDate' && value ? new Date(value as string) : (localTask.dueDate ? new Date(localTask.dueDate) : undefined)
        );
      } catch (error) {
        console.error('Failed to save field update:', error);
      }
    }

    onUpdate(updatedTask);
  };

  const handleFileUpload = () => {
    // Mock file upload
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const newAttachments = [...localTask.attachments, file.name];
        handleFieldUpdate('attachments', newAttachments);
      }
    };
    input.click();
  };

  return (
    <div className="border border-gray-200 rounded-lg mb-4 bg-white shadow-sm">
      <div
        className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex-shrink-0">
          <input
            type="checkbox"
            checked={localTask.completed}
            onChange={(e) => {
              e.stopPropagation();
              handleCheckboxChange(e.target.checked);
            }}
            className="w-5 h-5 rounded border-gray-300 text-[#1e40af] focus:ring-[#1e40af] cursor-pointer"
            disabled={isSaving}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h3 className={`font-bold text-lg ${localTask.completed ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
              {localTask.title}
            </h3>
            {isOverdue && (
              <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded-full">
                Overdue
              </span>
            )}
            {localTask.completed && (
              <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full">
                Complete
              </span>
            )}
          </div>
          {localTask.dueDate && (
            <p className="text-sm text-gray-500 mt-1">
              Due: {new Date(localTask.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          )}
        </div>
        <div className="flex-shrink-0">
          <svg
            className={`h-5 w-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {isOpen && (
        <div className="px-4 pb-4 pt-0 border-t border-gray-100">
          <div className="pt-4 space-y-4">
            <div>
              <p className="text-gray-700 text-sm leading-relaxed">{localTask.description}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Due Date
                </label>
                <input
                  type="date"
                  value={localTask.dueDate || ''}
                  onChange={(e) => handleFieldUpdate('dueDate', e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1e40af] focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Attachments
                </label>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFileUpload();
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors text-sm text-gray-700 flex items-center justify-center gap-2"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Attach File
                </button>
                {localTask.attachments.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {localTask.attachments.map((file, idx) => (
                      <div key={idx} className="text-xs text-gray-600 flex items-center gap-2">
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        {file}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                value={localTask.notes}
                onChange={(e) => handleFieldUpdate('notes', e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="Add your notes here..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1e40af] focus:border-transparent resize-none"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Add Custom Task Modal
function AddTaskModal({ isOpen, onClose, onAdd }: { isOpen: boolean; onClose: () => void; onAdd: (task: Omit<Task, 'id'>) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim()) {
      onAdd({
        title: title.trim(),
        description: description.trim(),
        completed: false,
        dueDate: dueDate || undefined,
        notes: '',
        attachments: [],
      });
      setTitle('');
      setDescription('');
      setDueDate('');
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Add Custom Task</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Task Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1e40af] focus:border-transparent"
                placeholder="Enter task title"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1e40af] focus:border-transparent resize-none"
                placeholder="Enter task description"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Due Date
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1e40af] focus:border-transparent"
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-[#1e40af] text-white rounded-md hover:bg-blue-700 transition-colors font-medium"
              >
                Add Task
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors font-medium"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function PhaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const phaseId = params.phaseId as string;
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const phase = phaseDataMap[phaseId] || phaseDataMap['1'];

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/planner/login');
    }
  }, [authLoading, isAuthenticated, router]);

  // Fetch tasks from Supabase
  useEffect(() => {
    async function fetchTasks() {
      if (!user?.id) return;

      try {
        setIsLoading(true);
        setError(null);

        // Get tasks with user progress from Supabase
        const tasksWithDetails = await getPhaseTasksWithDetails(user.id, phase.id);

        // Map to display format
        const displayTasks: Task[] = tasksWithDetails.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          completed: t.userTask?.completed || false,
          dueDate: t.userTask?.dueDate || undefined,
          notes: t.userTask?.notes || '',
          attachments: [],
        }));

        setTasks(displayTasks);
      } catch (err) {
        console.error('Error fetching tasks:', err);
        setError('Failed to load tasks. Using offline data.');

        // Fallback to seed data if Supabase fails
        const seedTasks = getPhaseSeedTasks(phase.id);
        setTasks(seedTasks.map(t => ({
          id: t.id,
          title: t.title,
          description: t.description,
          completed: false,
          dueDate: undefined,
          notes: '',
          attachments: [],
        })));
      } finally {
        setIsLoading(false);
      }
    }

    if (isAuthenticated && user) {
      fetchTasks();
    }
  }, [phase.id, user, isAuthenticated]);

  // Calculate progress
  const completedTasks = tasks.filter(t => t.completed).length;
  const totalTasks = tasks.length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const handleTaskUpdate = (updatedTask: Task) => {
    setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
  };

  const handleAddTask = (taskData: Omit<Task, 'id'>) => {
    const newTask: Task = {
      ...taskData,
      id: `${phase.id}-custom-${Date.now()}`,
    };
    setTasks(prev => [...prev, newTask]);
    // TODO: Save custom task to Supabase
  };

  const handleExportPDF = async () => {
    try {
      setIsExporting(true);

      // Prepare phase data for export
      const exportData: PhaseDataForExport = {
        phaseId: phase.id,
        phaseName: phase.name,
        phaseIcon: phase.icon,
        tasks: tasks.map(task => ({
          id: task.id,
          title: task.title,
          description: task.description,
          completed: task.completed,
          dueDate: task.dueDate,
          notes: task.notes,
        })),
        progress,
        completedTasks,
        totalTasks,
        userName: user?.email,
      };

      await exportPhaseToPDF(exportData);
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Failed to export PDF. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  // Loading state (auth or data)
  if (authLoading || (isAuthenticated && isLoading)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e40af] mx-auto mb-4"></div>
          <p className="text-gray-600">Loading phase tasks...</p>
        </div>
      </div>
    );
  }

  // Don't render anything while redirecting to login
  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navbar */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/planner" className="flex items-center gap-2">
              <span className="text-xl font-bold text-[#1e40af]">GovCon Giants</span>
              <span className="text-xl font-bold text-gray-700">Planner</span>
            </Link>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Error Banner */}
        {error && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg mb-6">
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Breadcrumb */}
        <nav className="mb-6" aria-label="Breadcrumb">
          <ol className="flex items-center space-x-2 text-sm text-gray-600">
            <li>
              <Link href="/planner" className="hover:text-[#1e40af] transition-colors">
                Home
              </Link>
            </li>
            <li>
              <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </li>
            <li className="text-gray-900 font-medium">
              Phase {phase.id}: {phase.name}
            </li>
          </ol>
        </nav>

        {/* Header */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 mb-6">
          <div className="flex items-center gap-4 mb-4">
            <span className="text-4xl">{phase.icon}</span>
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                Phase {phase.id}: {phase.name}
              </h1>
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span>{progress}% Complete</span>
                <span>•</span>
                <span>{completedTasks} of {totalTasks} tasks completed</span>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className="bg-[#1e40af] h-3 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Tasks Accordion */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Tasks</h2>
          {tasks.length === 0 ? (
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-8 text-center">
              <p className="text-gray-500">No tasks yet. Add your first task to get started!</p>
            </div>
          ) : (
            <div>
              {tasks.map((task) => (
                <AccordionItem
                  key={task.id}
                  task={task}
                  onUpdate={handleTaskUpdate}
                  userId={user?.id || ''}
                />
              ))}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex-1 px-6 py-3 bg-[#1e40af] text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-md flex items-center justify-center gap-2"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Custom Task
          </button>
          <button
            onClick={handleExportPDF}
            disabled={isExporting}
            className="flex-1 px-6 py-3 border-2 border-[#1e40af] text-[#1e40af] rounded-lg hover:bg-blue-50 transition-colors font-medium shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExporting ? (
              <>
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Exporting...
              </>
            ) : (
              <>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export Phase as PDF
              </>
            )}
          </button>
        </div>
      </div>

      {/* Add Task Modal */}
      <AddTaskModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={handleAddTask}
      />
    </div>
  );
}
