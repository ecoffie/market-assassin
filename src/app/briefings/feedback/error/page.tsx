import Link from 'next/link';

export default function FeedbackErrorPage() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl">⚠️</span>
        </div>
        <h1 className="text-2xl font-bold text-white mb-3">
          Something went wrong
        </h1>
        <p className="text-gray-400 mb-6">
          We couldn't record your feedback. Please try again later.
        </p>
        <Link
          href="/briefings"
          className="inline-block py-3 px-6 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition-colors"
        >
          Back to Briefings
        </Link>
      </div>
    </div>
  );
}
