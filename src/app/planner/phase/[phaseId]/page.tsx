'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { exportPhaseToPDF, type PhaseDataForExport } from '@/lib/utils/exportPlan';
import {
  getPhaseTasksWithDetails,
  updateTaskCompletion,
  getPhaseSeedTasks,
  saveCustomTask,
  deleteCustomTask,
  updateTaskOrder,
  bulkUpdateTasks,
  getUserProgress,
} from '@/lib/supabase/planner';
import { useAuth } from '@/lib/supabase/AuthContext';
import { updateStreak, checkAndAwardBadges } from '@/lib/supabase/gamification';
import ConfettiCelebration from '@/components/planner/ConfettiCelebration';

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

type FilterType = 'all' | 'pending' | 'completed' | 'overdue' | 'high';

// Task interface for display
interface Task {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  dueDate?: string;
  notes: string;
  priority: 'high' | 'medium' | 'low';
  isCustom: boolean;
  link: string;
}

// Priority Badge Component
function PriorityBadge({ priority }: { priority: 'high' | 'medium' | 'low' }) {
  const config = {
    high: { bg: 'bg-red-100', text: 'text-red-700', label: 'High' },
    medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Med' },
    low: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Low' },
  };
  const c = config[priority];
  return (
    <span className={`px-2 py-0.5 ${c.bg} ${c.text} text-xs font-semibold rounded-full`}>
      {c.label}
    </span>
  );
}

// Priority Selector Component
function PrioritySelector({
  priority,
  onChange,
}: {
  priority: 'high' | 'medium' | 'low';
  onChange: (p: 'high' | 'medium' | 'low') => void;
}) {
  const options: Array<{ value: 'high' | 'medium' | 'low'; label: string; activeClass: string }> = [
    { value: 'high', label: 'High', activeClass: 'bg-red-500 text-white' },
    { value: 'medium', label: 'Medium', activeClass: 'bg-yellow-500 text-white' },
    { value: 'low', label: 'Low', activeClass: 'bg-gray-400 text-white' },
  ];

  return (
    <div className="flex gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange(opt.value);
          }}
          className={`px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
            priority === opt.value ? opt.activeClass : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// Accordion Item Component
function AccordionItem({
  task,
  onUpdate,
  onDelete,
  userId,
  onDragStart,
  onDragOver,
  onDrop,
  isDragTarget,
}: {
  task: Task;
  onUpdate: (updatedTask: Task) => void;
  onDelete?: () => void;
  userId: string;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isDragTarget: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [localTask, setLocalTask] = useState(task);
  const [isSaving, setIsSaving] = useState(false);
  const notesTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update local task when prop changes
  useEffect(() => {
    setLocalTask(task);
  }, [task]);

  const isOverdue = localTask.dueDate && !localTask.completed && new Date(localTask.dueDate) < new Date();

  const handleCheckboxChange = async (checked: boolean) => {
    const updatedTask = { ...localTask, completed: checked };
    setLocalTask(updatedTask);
    setIsSaving(true);

    try {
      await updateTaskCompletion(
        userId,
        localTask.id,
        checked,
        localTask.notes || undefined,
        localTask.dueDate ? new Date(localTask.dueDate) : undefined,
        localTask.priority,
        localTask.link || undefined
      );

      onUpdate(updatedTask);
    } catch (error) {
      setLocalTask(localTask);
      console.error('Failed to update task:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleFieldUpdate = async (field: keyof Task, value: string | string[]) => {
    const updatedTask = { ...localTask, [field]: value };
    setLocalTask(updatedTask);

    if (field === 'notes') {
      // Debounce notes saves
      if (notesTimeoutRef.current) clearTimeout(notesTimeoutRef.current);
      notesTimeoutRef.current = setTimeout(async () => {
        try {
          await updateTaskCompletion(
            userId,
            localTask.id,
            localTask.completed,
            value as string,
            localTask.dueDate ? new Date(localTask.dueDate) : undefined,
            localTask.priority,
            localTask.link || undefined
          );
        } catch (error) {
          console.error('Failed to save notes:', error);
        }
      }, 800);
      onUpdate(updatedTask);
      return;
    }

    if (field === 'dueDate' || field === 'link') {
      try {
        await updateTaskCompletion(
          userId,
          localTask.id,
          localTask.completed,
          localTask.notes || undefined,
          field === 'dueDate' && value ? new Date(value as string) : (localTask.dueDate ? new Date(localTask.dueDate) : undefined),
          localTask.priority,
          field === 'link' ? (value as string) : (localTask.link || undefined)
        );
      } catch (error) {
        console.error('Failed to save field update:', error);
      }
    }

    onUpdate(updatedTask);
  };

  const handlePriorityChange = async (newPriority: 'high' | 'medium' | 'low') => {
    const updatedTask = { ...localTask, priority: newPriority };
    setLocalTask(updatedTask);

    try {
      await updateTaskCompletion(
        userId,
        localTask.id,
        localTask.completed,
        localTask.notes || undefined,
        localTask.dueDate ? new Date(localTask.dueDate) : undefined,
        newPriority,
        localTask.link || undefined
      );
    } catch (error) {
      console.error('Failed to save priority:', error);
    }

    onUpdate(updatedTask);
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`border rounded-lg mb-2 bg-white shadow-sm transition-all ${
        isDragTarget ? 'border-[#1e40af] border-2 shadow-md' : 'border-gray-200'
      }`}
    >
      <div
        className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        {/* Drag handle */}
        <div className="flex-shrink-0 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing" onMouseDown={(e) => e.stopPropagation()}>
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
          </svg>
        </div>

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
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={`font-bold text-base ${localTask.completed ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
              {localTask.title}
            </h3>
            <PriorityBadge priority={localTask.priority} />
            {localTask.isCustom && (
              <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-semibold rounded-full">
                Custom
              </span>
            )}
            {isOverdue && (
              <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-semibold rounded-full">
                Overdue
              </span>
            )}
            {localTask.completed && (
              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full">
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
        <div className="flex items-center gap-2 flex-shrink-0">
          {localTask.isCustom && onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1 text-gray-400 hover:text-red-500 transition-colors"
              title="Delete custom task"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
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

            {/* Priority Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
              <PrioritySelector priority={localTask.priority} onChange={handlePriorityChange} />
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
                  Reference Link
                </label>
                <input
                  type="url"
                  value={localTask.link || ''}
                  onChange={(e) => handleFieldUpdate('link', e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="https://..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1e40af] focus:border-transparent"
                />
                {localTask.link && (
                  <a
                    href={localTask.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 mt-1 text-sm text-[#1e40af] hover:underline"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Open link
                  </a>
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
function AddTaskModal({
  isOpen,
  onClose,
  onAdd,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (task: { title: string; description: string; dueDate?: string; priority: 'high' | 'medium' | 'low' }) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim()) {
      onAdd({
        title: title.trim(),
        description: description.trim(),
        dueDate: dueDate || undefined,
        priority,
      });
      setTitle('');
      setDescription('');
      setDueDate('');
      setPriority('medium');
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Priority
                </label>
                <PrioritySelector priority={priority} onChange={setPriority} />
              </div>
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

// Bulk Actions Dropdown
function BulkActionsDropdown({
  onAction,
}: {
  onAction: (action: 'complete' | 'incomplete' | 'clear_notes') => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-4 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium flex items-center gap-2"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
        </svg>
        Bulk Actions
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 bottom-full mb-2 w-52 rounded-lg bg-white shadow-lg border border-gray-200 z-20 py-1">
            <button
              onClick={() => { onAction('complete'); setIsOpen(false); }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <svg className="h-4 w-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Mark All Complete
            </button>
            <button
              onClick={() => { onAction('incomplete'); setIsOpen(false); }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Mark All Incomplete
            </button>
            <button
              onClick={() => { onAction('clear_notes'); setIsOpen(false); }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <svg className="h-4 w-4 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Clear All Notes
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Toast notification
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed bottom-6 right-6 z-50 bg-[#1e40af] text-white px-6 py-3 rounded-lg shadow-xl flex items-center gap-3 animate-[slideUp_0.3s_ease-out]">
      <span className="text-xl">🏆</span>
      <span className="font-medium">{message}</span>
      <button onClick={onClose} className="ml-2 text-white/70 hover:text-white">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
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
  const [filter, setFilter] = useState<FilterType>('all');
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const draggedTaskIdRef = useRef<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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

        const tasksWithDetails = await getPhaseTasksWithDetails(user.id, phase.id);

        const displayTasks: Task[] = tasksWithDetails.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          completed: t.userTask?.completed || false,
          dueDate: t.userTask?.dueDate || undefined,
          notes: t.userTask?.notes || '',
          priority: ((t.userTask as any)?.priority || t.priority || 'medium') as 'high' | 'medium' | 'low',
          isCustom: t.isCustom || false,
          link: ((t.userTask as any)?.link || t.link || '') as string,
        }));

        setTasks(displayTasks);
      } catch (err) {
        console.error('Error fetching tasks:', err);
        setError('Failed to load tasks. Using offline data.');

        const seedTasks = getPhaseSeedTasks(phase.id);
        setTasks(seedTasks.map(t => ({
          id: t.id,
          title: t.title,
          description: t.description,
          completed: false,
          dueDate: undefined,
          notes: '',
          priority: 'medium' as const,
          isCustom: false,
          link: '',
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

  // Filter tasks
  const filteredTasks = tasks.filter(task => {
    switch (filter) {
      case 'pending': return !task.completed;
      case 'completed': return task.completed;
      case 'overdue': return task.dueDate && !task.completed && new Date(task.dueDate) < new Date();
      case 'high': return task.priority === 'high';
      default: return true;
    }
  });

  // Gamification check after task completion
  const handleGamificationCheck = useCallback(async (wasCompleted: boolean) => {
    if (!user?.id || !wasCompleted) return;

    try {
      const streak = await updateStreak(user.id);
      const progressData = await getUserProgress(user.id);
      const totalCompleted = progressData.completedTasks;
      const phaseComplete = progress === 100;
      const allComplete = progressData.overall === 100;

      const newBadges = await checkAndAwardBadges(
        user.id,
        totalCompleted,
        streak,
        phaseComplete,
        allComplete
      );

      if (newBadges.length > 0) {
        setShowConfetti(true);
        setToastMessage(`Badge earned: ${newBadges[0].name} ${newBadges[0].icon}`);
      } else if (phaseComplete) {
        setShowConfetti(true);
        setToastMessage('Phase complete! Amazing work!');
      }
    } catch (err) {
      console.error('Gamification error:', err);
    }
  }, [user?.id, progress]);

  const handleTaskUpdate = (updatedTask: Task) => {
    const oldTask = tasks.find(t => t.id === updatedTask.id);
    setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));

    // Check if task was just completed
    if (!oldTask?.completed && updatedTask.completed) {
      handleGamificationCheck(true);
    }
  };

  const handleAddTask = async (taskData: { title: string; description: string; dueDate?: string; priority: 'high' | 'medium' | 'low' }) => {
    if (!user?.id) return;

    try {
      const taskId = await saveCustomTask(
        user.id,
        phase.id,
        taskData.title,
        taskData.description,
        taskData.dueDate,
        taskData.priority
      );

      const newTask: Task = {
        id: taskId,
        title: taskData.title,
        description: taskData.description,
        completed: false,
        dueDate: taskData.dueDate,
        notes: '',
        priority: taskData.priority,
        isCustom: true,
        link: '',
      };
      setTasks(prev => [...prev, newTask]);
    } catch (err) {
      console.error('Failed to add custom task:', err);
      alert('Failed to add task. Please try again.');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!user?.id) return;
    if (!confirm('Delete this custom task?')) return;

    try {
      await deleteCustomTask(user.id, taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (err) {
      console.error('Failed to delete task:', err);
      alert('Failed to delete task. Please try again.');
    }
  };

  // Drag and drop handlers
  const handleDragStart = (taskId: string) => (e: React.DragEvent) => {
    draggedTaskIdRef.current = taskId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
  };

  const handleDragOver = (taskId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedTaskIdRef.current !== taskId) {
      setDragOverTaskId(taskId);
    }
  };

  const handleDrop = (targetTaskId: string) => async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverTaskId(null);
    const draggedId = draggedTaskIdRef.current;
    draggedTaskIdRef.current = null;

    if (!draggedId || draggedId === targetTaskId || !user?.id) return;

    // Reorder locally
    const newTasks = [...tasks];
    const draggedIndex = newTasks.findIndex(t => t.id === draggedId);
    const targetIndex = newTasks.findIndex(t => t.id === targetTaskId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const [draggedTask] = newTasks.splice(draggedIndex, 1);
    newTasks.splice(targetIndex, 0, draggedTask);
    setTasks(newTasks);

    // Persist order
    try {
      await updateTaskOrder(user.id, phase.id, newTasks.map(t => t.id));
    } catch (err) {
      console.error('Failed to save order:', err);
    }
  };

  // Bulk actions
  const handleBulkAction = async (action: 'complete' | 'incomplete' | 'clear_notes') => {
    if (!user?.id) return;

    try {
      switch (action) {
        case 'complete':
          await bulkUpdateTasks(user.id, phase.id, { completed: true });
          setTasks(prev => prev.map(t => ({ ...t, completed: true })));
          handleGamificationCheck(true);
          break;
        case 'incomplete':
          await bulkUpdateTasks(user.id, phase.id, { completed: false });
          setTasks(prev => prev.map(t => ({ ...t, completed: false })));
          break;
        case 'clear_notes':
          await bulkUpdateTasks(user.id, phase.id, { notes: null });
          setTasks(prev => prev.map(t => ({ ...t, notes: '' })));
          break;
      }
    } catch (err) {
      console.error('Bulk action failed:', err);
      alert('Bulk action failed. Please try again.');
    }
  };

  const handleExportPDF = async () => {
    try {
      setIsExporting(true);

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
          priority: task.priority,
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

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'completed', label: 'Completed' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'high', label: 'High Priority' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <ConfettiCelebration show={showConfetti} onComplete={() => setShowConfetti(false)} />
      {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage(null)} />}

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
                <span>-</span>
                <span>{completedTasks} of {totalTasks} tasks completed</span>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all duration-500 ${progress === 100 ? 'bg-green-500' : 'bg-[#1e40af]'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap gap-2 mb-4">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                filter === f.key
                  ? 'bg-[#1e40af] text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Tasks List */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-gray-900">Tasks</h2>
            <span className="text-sm text-gray-500">
              {filteredTasks.length} of {totalTasks} shown
            </span>
          </div>

          {filteredTasks.length === 0 ? (
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-8 text-center">
              <p className="text-gray-500">
                {filter === 'all'
                  ? 'No tasks yet. Add your first task to get started!'
                  : `No ${filter} tasks found.`}
              </p>
            </div>
          ) : (
            <div>
              {filteredTasks.map((task) => (
                <AccordionItem
                  key={task.id}
                  task={task}
                  onUpdate={handleTaskUpdate}
                  onDelete={task.isCustom ? () => handleDeleteTask(task.id) : undefined}
                  userId={user?.id || ''}
                  onDragStart={handleDragStart(task.id)}
                  onDragOver={handleDragOver(task.id)}
                  onDrop={handleDrop(task.id)}
                  isDragTarget={dragOverTaskId === task.id}
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
          <BulkActionsDropdown onAction={handleBulkAction} />
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
                Export as PDF
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

      <style jsx global>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
