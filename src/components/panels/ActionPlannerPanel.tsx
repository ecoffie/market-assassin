'use client';

// ActionPlannerPanel - 36-Task Roadmap
// This is a placeholder - will be extracted from /planner

interface ActionPlannerPanelProps {
  email: string;
}

export default function ActionPlannerPanel({ email }: ActionPlannerPanelProps) {
  const phases = [
    { name: 'Phase 1: Foundation', tasks: 8, completed: 0 },
    { name: 'Phase 2: Registration', tasks: 6, completed: 0 },
    { name: 'Phase 3: Positioning', tasks: 7, completed: 0 },
    { name: 'Phase 4: Pursuit', tasks: 8, completed: 0 },
    { name: 'Phase 5: Proposal', tasks: 7, completed: 0 },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Action Planner</h2>
        <p className="text-gray-400 mt-1">
          36-task roadmap to federal contracting success
        </p>
      </div>

      {/* Progress overview */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-white font-medium">Overall Progress</span>
          <span className="text-emerald-400">0 / 36 tasks</span>
        </div>
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 rounded-full" style={{ width: '0%' }} />
        </div>
      </div>

      {/* Phases */}
      <div className="space-y-4">
        {phases.map((phase, i) => (
          <div key={phase.name} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center text-white font-medium">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-white font-medium">{phase.name}</h3>
                  <p className="text-gray-400 text-sm">{phase.tasks} tasks</p>
                </div>
              </div>
              <button className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded">
                Start
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-sm text-gray-500 mt-6 text-center">
        Action planner will track progress for {email || 'user'}
      </p>
    </div>
  );
}
