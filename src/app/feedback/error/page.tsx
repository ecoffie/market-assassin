export default function FeedbackErrorPage() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-xl p-8 max-w-md text-center shadow-xl border border-slate-700">
        <div className="text-6xl mb-4">😕</div>
        <h1 className="text-2xl font-bold text-white mb-2">Something went wrong</h1>
        <p className="text-slate-300 mb-6">
          We couldn't record your feedback. Please try again or contact support.
        </p>

        <div className="space-y-3">
          <a
            href="/alerts/preferences"
            className="block w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition"
          >
            Update My Preferences
          </a>
          <a
            href="https://govcongiants.org"
            className="block w-full py-3 px-4 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition"
          >
            Back to GovCon Giants
          </a>
        </div>

        <p className="text-slate-500 text-sm mt-6">
          Need help? Email{' '}
          <a href="mailto:service@govcongiants.com" className="text-blue-400 hover:underline">
            service@govcongiants.com
          </a>
        </p>
      </div>
    </div>
  );
}
