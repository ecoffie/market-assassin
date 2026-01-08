'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

// Motivational quotes from Eric Coffie
const quotes = [
  {
    text: "Consistency wins contracts",
    author: "Eric Coffie",
  },
  {
    text: "Your network is your net worth in government contracting",
    author: "Eric Coffie",
  },
  {
    text: "Every 'no' gets you closer to a 'yes'",
    author: "Eric Coffie",
  },
  {
    text: "Preparation meets opportunity in government contracting",
    author: "Eric Coffie",
  },
  {
    text: "Small businesses win big when they think strategically",
    author: "Eric Coffie",
  },
];

// YouTube video placeholders (replace with actual bootcamp video IDs)
const bootcampVideos = [
  {
    id: 'dQw4w9WgXcQ', // Placeholder - replace with actual video ID
    title: 'How to Create Your SAM.gov Profile',
    description: 'Step-by-step guide to registering in SAM.gov and setting up your federal contractor profile.',
  },
  {
    id: 'dQw4w9WgXcQ', // Placeholder - replace with actual video ID
    title: 'Writing Winning Capability Statements',
    description: 'Learn how to create compelling capability statements that stand out to government buyers.',
  },
  {
    id: 'dQw4w9WgXcQ', // Placeholder - replace with actual video ID
    title: 'Finding and Responding to Opportunities',
    description: 'Master the art of finding government contracting opportunities and crafting winning proposals.',
  },
  {
    id: 'dQw4w9WgXcQ', // Placeholder - replace with actual video ID
    title: 'Networking with Government Buyers',
    description: 'Strategies for building relationships with contracting officers and program managers.',
  },
];

// Downloadable templates
const templates = [
  {
    name: 'Capability Statement Template',
    description: 'Professional one-page capability statement template with sections for core competencies, past performance, and differentiators.',
    file: '/templates/capability-statement-template.pdf',
    icon: '📄',
  },
  {
    name: 'Email Scripts for SBLO Outreach',
    description: 'Ready-to-use email templates for reaching out to Small Business Liaison Officers and contracting officers.',
    file: '/templates/email-scripts-sblo.pdf',
    icon: '✉️',
  },
  {
    name: 'Proposal Response Checklist',
    description: 'Comprehensive checklist to ensure your proposal responses are complete and compliant.',
    file: '/templates/proposal-checklist.pdf',
    icon: '✅',
  },
  {
    name: 'Past Performance Questionnaire',
    description: 'Template for collecting past performance information from previous clients and prime contractors.',
    file: '/templates/past-performance-questionnaire.pdf',
    icon: '📊',
  },
];

// Quick tips from bootcamp
const quickTips = [
  {
    icon: '🎯',
    title: 'Target Your NAICS Codes',
    tip: 'Focus on 3-5 primary NAICS codes that best represent your core capabilities. Too many codes can dilute your positioning.',
  },
  {
    icon: '🤝',
    title: 'Build Relationships First',
    tip: 'Meet with government buyers before opportunities are released. Relationships win contracts, not just proposals.',
  },
  {
    icon: '📝',
    title: 'Keep Capability Statements Updated',
    tip: 'Update your capability statement quarterly with new projects, certifications, and key personnel changes.',
  },
  {
    icon: '🔍',
    title: 'Monitor Contract Awards',
    tip: 'Track contract awards to identify subcontracting opportunities with prime contractors who won contracts.',
  },
  {
    icon: '⭐',
    title: 'Highlight Your Differentiators',
    tip: 'Clearly communicate what makes you unique. Government buyers need to know why they should choose you.',
  },
  {
    icon: '📅',
    title: 'Set Up Opportunity Alerts',
    tip: 'Use SAM.gov and agency websites to set up automated alerts for opportunities matching your NAICS codes.',
  },
  {
    icon: '💼',
    title: 'Get on Supplier Lists',
    tip: 'Register with prime contractors\' supplier portals. Many subcontracting opportunities come through these lists.',
  },
  {
    icon: '🎓',
    title: 'Leverage APEX Accelerator',
    tip: 'Your local APEX Accelerator (formerly PTAC) offers free counseling. Use their expertise to navigate the process.',
  },
  {
    icon: '📈',
    title: 'Track Your Progress',
    tip: 'Monitor which opportunities you\'re pursuing, meetings you\'ve attended, and relationships you\'re building.',
  },
  {
    icon: '🏆',
    title: 'Focus on Past Performance',
    tip: 'Document your past performance early. Strong past performance is often the deciding factor in contract awards.',
  },
  {
    icon: '💡',
    title: 'Understand Set-Asides',
    tip: 'Know which small business set-asides you qualify for (8(a), WOSB, HUBZone, SDVOSB) and target those opportunities.',
  },
  {
    icon: '🚀',
    title: 'Start Small, Think Big',
    tip: 'Begin with smaller contracts to build past performance, then scale to larger opportunities as you gain experience.',
  },
];

export default function ResourcesPage() {
  const [currentQuote, setCurrentQuote] = useState(0);

  // Rotate quotes every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentQuote((prev) => (prev + 1) % quotes.length);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

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
            <li className="text-gray-900 font-medium">Resources</li>
          </ol>
        </nav>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Action Plan Resources</h1>
          <p className="text-lg text-gray-600">
            Access bootcamp videos, templates, and quick tips to accelerate your government contracting success
          </p>
        </div>

        {/* Motivational Quote Section */}
        <div className="bg-gradient-to-r from-[#1e40af] to-blue-600 rounded-lg shadow-md p-6 mb-8 text-white">
          <div className="flex items-center gap-4">
            <div className="text-4xl">💪</div>
            <div className="flex-1">
              <p className="text-2xl font-semibold italic mb-2 transition-opacity duration-500">
                "{quotes[currentQuote].text}"
              </p>
              <p className="text-lg opacity-90">— {quotes[currentQuote].author}</p>
            </div>
          </div>
          <div className="flex gap-2 mt-4 justify-center">
            {quotes.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentQuote(index)}
                className={`h-2 rounded-full transition-all ${
                  index === currentQuote ? 'bg-white w-8' : 'bg-white/50 w-2'
                }`}
                aria-label={`View quote ${index + 1}`}
              />
            ))}
          </div>
        </div>

        {/* YouTube Videos Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-[#1e40af] mb-6 flex items-center gap-2">
            <span>📹</span>
            Bootcamp Video Library
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {bootcampVideos.map((video, index) => (
              <div key={index} className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
                <div className="aspect-video bg-gray-100">
                  <iframe
                    width="100%"
                    height="100%"
                    src={`https://www.youtube.com/embed/${video.id}`}
                    title={video.title}
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="w-full h-full"
                  />
                </div>
                <div className="p-4">
                  <h3 className="font-bold text-lg text-gray-900 mb-2">{video.title}</h3>
                  <p className="text-sm text-gray-600">{video.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Downloadable Templates Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-[#1e40af] mb-6 flex items-center gap-2">
            <span>📥</span>
            Downloadable Templates
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {templates.map((template, index) => (
              <div
                key={index}
                className="bg-white rounded-lg shadow-md border border-gray-200 p-6 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start gap-4">
                  <div className="text-4xl flex-shrink-0">{template.icon}</div>
                  <div className="flex-1">
                    <h3 className="font-bold text-lg text-gray-900 mb-2">{template.name}</h3>
                    <p className="text-sm text-gray-600 mb-4">{template.description}</p>
                    <a
                      href={template.file}
                      download
                      className="inline-flex items-center gap-2 px-4 py-2 bg-[#1e40af] text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Download Template
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Quick Tips Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-[#1e40af] mb-6 flex items-center gap-2">
            <span>💡</span>
            Quick Tips from Bootcamp
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {quickTips.map((tip, index) => (
              <div
                key={index}
                className="bg-white rounded-lg shadow-md border border-gray-200 p-6 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start gap-4">
                  <div className="text-3xl flex-shrink-0">{tip.icon}</div>
                  <div className="flex-1">
                    <h3 className="font-bold text-lg text-gray-900 mb-2">{tip.title}</h3>
                    <p className="text-sm text-gray-600 leading-relaxed">{tip.tip}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Call to Action */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Ready to Take Action?</h2>
          <p className="text-gray-600 mb-6">
            Use these resources alongside your Action Plan to accelerate your government contracting success.
          </p>
          <Link
            href="/planner"
            className="inline-block px-6 py-3 bg-[#1e40af] text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}



