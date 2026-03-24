'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getPhases, getPhaseSeedTasks, type VideoLesson } from '@/lib/supabase/planner';

// Get all lessons organized by phase
function getAllLessons() {
  const phases = getPhases();
  const lessonsData: Array<{
    phaseId: number;
    phaseName: string;
    phaseIcon: string;
    taskTitle: string;
    taskOrder: number;
    lessons: VideoLesson[];
  }> = [];

  phases.forEach(phase => {
    const tasks = getPhaseSeedTasks(phase.id);
    tasks.forEach(task => {
      if ((task as any).videoLessons && (task as any).videoLessons.length > 0) {
        lessonsData.push({
          phaseId: phase.id,
          phaseName: phase.name,
          phaseIcon: phase.icon,
          taskTitle: task.title,
          taskOrder: task.order,
          lessons: (task as any).videoLessons,
        });
      }
    });
  });

  return lessonsData;
}

export default function LessonsPage() {
  const [selectedPhase, setSelectedPhase] = useState<number | 'all'>('all');
  const phases = getPhases();
  const allLessons = getAllLessons();

  const filteredLessons = selectedPhase === 'all'
    ? allLessons
    : allLessons.filter(l => l.phaseId === selectedPhase);

  // Count total videos
  const totalVideos = allLessons.reduce((sum, t) => sum + t.lessons.length, 0);

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
            <li className="text-gray-900 font-medium">Training Videos</li>
          </ol>
        </nav>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Training Video Library</h1>
          <p className="text-lg text-gray-600">
            {totalVideos} micro-lessons to guide you through your government contracting journey
          </p>
        </div>

        {/* Phase Filter */}
        <div className="flex flex-wrap gap-2 mb-8">
          <button
            onClick={() => setSelectedPhase('all')}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              selectedPhase === 'all'
                ? 'bg-[#1e40af] text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            All Phases
          </button>
          {phases.map(phase => (
            <button
              key={phase.id}
              onClick={() => setSelectedPhase(phase.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-2 ${
                selectedPhase === phase.id
                  ? 'bg-[#1e40af] text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span>{phase.icon}</span>
              Phase {phase.id}
            </button>
          ))}
        </div>

        {/* Lessons Grid */}
        <div className="space-y-8">
          {filteredLessons.map((taskGroup, idx) => (
            <div key={idx} className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
              {/* Task Header */}
              <div className="bg-gradient-to-r from-[#1e40af] to-blue-600 px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{taskGroup.phaseIcon}</span>
                  <div>
                    <p className="text-white/80 text-sm">
                      Phase {taskGroup.phaseId}: {taskGroup.phaseName} - Task {taskGroup.taskOrder}
                    </p>
                    <h2 className="text-white font-bold text-lg">{taskGroup.taskTitle}</h2>
                  </div>
                </div>
              </div>

              {/* Lessons List */}
              <div className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {taskGroup.lessons.map((lesson, lessonIdx) => (
                    <div
                      key={lesson.id}
                      className="bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition-colors border border-gray-100"
                    >
                      {/* Video Thumbnail Placeholder */}
                      <div className="aspect-video bg-gradient-to-br from-[#1e40af]/10 to-purple-100 rounded-lg mb-3 flex items-center justify-center relative overflow-hidden">
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                            <svg className="w-6 h-6 text-[#1e40af] ml-1" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </div>
                        </div>
                        <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                          {lesson.duration}
                        </div>
                        <div className="absolute top-2 left-2 bg-[#1e40af] text-white text-xs font-bold px-2 py-1 rounded">
                          Part {lessonIdx + 1}
                        </div>
                      </div>

                      {/* Lesson Info */}
                      <h3 className="font-semibold text-gray-900 text-sm mb-2">{lesson.title}</h3>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">{lesson.id}</span>
                        {lesson.vimeoId && lesson.vimeoId !== 'PLACEHOLDER' ? (
                          <a
                            href={`https://vimeo.com/${lesson.vimeoId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 bg-[#1e40af] text-white text-xs font-medium rounded-md hover:bg-blue-700 transition-colors"
                          >
                            Watch Now
                          </a>
                        ) : (
                          <span className="px-3 py-1.5 bg-gray-200 text-gray-500 text-xs font-medium rounded-md">
                            Coming Soon
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {filteredLessons.length === 0 && (
          <div className="bg-white rounded-lg shadow-md border border-gray-200 p-8 text-center">
            <p className="text-gray-500">No video lessons available for this phase yet.</p>
          </div>
        )}

        {/* Call to Action */}
        <div className="mt-8 bg-gradient-to-r from-[#1e40af] to-purple-600 rounded-lg p-8 text-center text-white">
          <h2 className="text-2xl font-bold mb-2">Ready to Put This Knowledge to Work?</h2>
          <p className="mb-6 text-white/90">
            Track your progress and complete tasks in your Action Plan
          </p>
          <Link
            href="/planner"
            className="inline-block px-6 py-3 bg-white text-[#1e40af] rounded-lg hover:bg-gray-100 transition-colors font-semibold"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
