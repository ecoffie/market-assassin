'use client';

// ContentReaperPanel - AI Content Generator
// This is a placeholder - will be extracted from /content-generator

interface ContentReaperPanelProps {
  email: string;
}

export default function ContentReaperPanel({ email }: ContentReaperPanelProps) {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Content Reaper</h2>
        <p className="text-gray-400 mt-1">
          AI-powered LinkedIn content for government contractors
        </p>
      </div>

      {/* Content types */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {[
          { name: 'LinkedIn Posts', icon: '📝', count: 30 },
          { name: 'Capability Statements', icon: '📄', count: 5 },
          { name: 'Email Templates', icon: '✉️', count: 10 },
        ].map((type) => (
          <div key={type.name} className="bg-gray-800 rounded-lg p-4 border border-gray-700 text-center">
            <span className="text-3xl">{type.icon}</span>
            <h3 className="text-white font-medium mt-2">{type.name}</h3>
            <p className="text-purple-400 text-sm">{type.count} per click</p>
          </div>
        ))}
      </div>

      {/* Generate button placeholder */}
      <div className="bg-gray-800/50 rounded-lg p-8 text-center border border-gray-700">
        <button className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg">
          Generate Content
        </button>
        <p className="text-gray-500 text-sm mt-4">
          Content generator will be embedded here for {email || 'user'}
        </p>
      </div>
    </div>
  );
}
