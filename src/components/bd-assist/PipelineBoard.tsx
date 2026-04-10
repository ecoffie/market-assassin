'use client';

import { useState, useEffect } from 'react';
import PipelineCard from './PipelineCard';
import PipelineModal, { PipelineFormData } from './PipelineModal';

export interface PipelineBoardProps {
  email: string;
}

interface PipelineOpportunity {
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
  naics_code?: string;
  set_aside?: string;
  notes?: string;
  external_url?: string;
  teaming_partners?: string[] | string;
}

const STAGES = [
  { key: 'tracking', label: 'Tracking', color: 'bg-gray-100' },
  { key: 'pursuing', label: 'Pursuing', color: 'bg-blue-100' },
  { key: 'bidding', label: 'Bidding', color: 'bg-yellow-100' },
  { key: 'submitted', label: 'Submitted', color: 'bg-purple-100' },
  { key: 'won', label: 'Won', color: 'bg-green-100' },
  { key: 'lost', label: 'Lost', color: 'bg-red-100' }
];

export default function PipelineBoard({ email }: PipelineBoardProps) {
  const [opportunities, setOpportunities] = useState<PipelineOpportunity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PipelineOpportunity | null>(null);

  // Load pipeline data
  const loadPipeline = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/pipeline?email=${encodeURIComponent(email)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load pipeline');
      }

      setOpportunities(data.opportunities || []);
    } catch (err) {
      console.error('Failed to load pipeline:', err);
      setError(err instanceof Error ? err.message : 'Failed to load pipeline');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (email) {
      loadPipeline();
    }
  }, [email]);

  // Handle stage change
  const handleStageChange = async (id: string, newStage: string) => {
    try {
      const response = await fetch('/api/pipeline', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          user_email: email,
          stage: newStage
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update stage');
      }

      // Update local state
      setOpportunities(prev =>
        prev.map(opp =>
          opp.id === id ? { ...opp, stage: newStage } : opp
        )
      );
    } catch (err) {
      console.error('Failed to update stage:', err);
      alert(err instanceof Error ? err.message : 'Failed to update stage');
    }
  };

  // Handle edit
  const handleEdit = (id: string) => {
    const item = opportunities.find(opp => opp.id === id);
    if (item) {
      setEditingItem(item);
      setIsModalOpen(true);
    }
  };

  // Handle delete
  const handleDelete = async (id: string) => {
    try {
      const response = await fetch('/api/pipeline', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          user_email: email
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete');
      }

      // Update local state
      setOpportunities(prev => prev.filter(opp => opp.id !== id));
    } catch (err) {
      console.error('Failed to delete:', err);
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  // Handle save (add or update)
  const handleSave = async (formData: PipelineFormData) => {
    const isEditing = !!editingItem;

    try {
      const response = await fetch('/api/pipeline', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isEditing ? { id: editingItem.id } : {}),
          user_email: email,
          ...formData
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save');
      }

      // Reload pipeline to get fresh data
      await loadPipeline();

      setIsModalOpen(false);
      setEditingItem(null);
    } catch (err) {
      console.error('Failed to save:', err);
      throw err; // Re-throw so modal can show error
    }
  };

  // Group opportunities by stage
  const groupedByStage = STAGES.reduce((acc, stage) => {
    acc[stage.key] = opportunities.filter(opp => opp.stage === stage.key);
    return acc;
  }, {} as Record<string, PipelineOpportunity[]>);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your pipeline...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <div className="text-red-600 font-semibold mb-2">Failed to Load Pipeline</div>
        <p className="text-red-700 text-sm mb-4">{error}</p>
        <button
          onClick={loadPipeline}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  const totalOpps = opportunities.length;
  const activeOpps = opportunities.filter(o => !['won', 'lost'].includes(o.stage)).length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-gray-200">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">My Pipeline</h2>
          <p className="text-sm text-gray-600 mt-1">
            {totalOpps} {totalOpps === 1 ? 'opportunity' : 'opportunities'}
            {activeOpps > 0 && ` • ${activeOpps} active`}
          </p>
        </div>
        <button
          onClick={() => {
            setEditingItem(null);
            setIsModalOpen(true);
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors flex items-center gap-2"
        >
          <span className="text-xl">+</span>
          Add Opportunity
        </button>
      </div>

      {/* Kanban Board */}
      <div className="p-6">
        {totalOpps === 0 ? (
          // Empty State
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Opportunities Yet</h3>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              Start tracking your opportunities by adding them to your pipeline.
              Monitor progress from initial tracking through to win or loss.
            </p>
            <button
              onClick={() => {
                setEditingItem(null);
                setIsModalOpen(true);
              }}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
            >
              Add Your First Opportunity
            </button>
          </div>
        ) : (
          // Kanban Columns
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {STAGES.map(stage => {
              const stageOpps = groupedByStage[stage.key] || [];
              const stageCount = stageOpps.length;

              return (
                <div key={stage.key} className="flex flex-col min-h-[400px]">
                  {/* Column Header */}
                  <div className={`${stage.color} border-2 border-gray-300 rounded-t-lg px-4 py-3`}>
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-gray-900 uppercase text-sm">
                        {stage.label}
                      </h3>
                      <span className="bg-white text-gray-700 text-xs font-bold px-2 py-1 rounded-full">
                        {stageCount}
                      </span>
                    </div>
                  </div>

                  {/* Column Content */}
                  <div className="flex-1 bg-gray-50 border-l-2 border-r-2 border-b-2 border-gray-300 rounded-b-lg p-3 space-y-3 overflow-y-auto max-h-[600px]">
                    {stageOpps.length === 0 ? (
                      <div className="text-center py-8 text-gray-400 text-sm">
                        No items
                      </div>
                    ) : (
                      stageOpps.map(opp => (
                        <PipelineCard
                          key={opp.id}
                          item={opp}
                          onStageChange={handleStageChange}
                          onEdit={handleEdit}
                          onDelete={handleDelete}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      <PipelineModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingItem(null);
        }}
        onSave={handleSave}
        initialData={editingItem ? {
          id: editingItem.id,
          title: editingItem.title,
          agency: editingItem.agency,
          value_estimate: editingItem.value_estimate,
          naics_code: editingItem.naics_code,
          set_aside: editingItem.set_aside,
          response_deadline: editingItem.response_deadline,
          priority: editingItem.priority as any,
          win_probability: editingItem.win_probability,
          notes: editingItem.notes,
          source: editingItem.source,
          external_url: editingItem.external_url,
          teaming_partners: Array.isArray(editingItem.teaming_partners)
            ? editingItem.teaming_partners.join(', ')
            : editingItem.teaming_partners,
          stage: editingItem.stage
        } : null}
        email={email}
      />
    </div>
  );
}
