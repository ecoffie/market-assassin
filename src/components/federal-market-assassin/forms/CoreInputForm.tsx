'use client';

import { useState } from 'react';
import { CoreInputs, BusinessType, VeteranStatus } from '@/types/federal-market-assassin';

interface CoreInputFormProps {
  onSubmit: (inputs: CoreInputs) => void;
  loading: boolean;
}

export default function CoreInputForm({ onSubmit, loading }: CoreInputFormProps) {
  const [formData, setFormData] = useState<Partial<CoreInputs>>({
    businessType: undefined,
    naicsCode: '',
    zipCode: '',
    veteranStatus: 'Not Applicable',
    pscCode: '',
    companyName: '',
    excludeDOD: false,
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    // Business type is always required
    if (!formData.businessType) {
      setValidationError('Please select a business type');
      return;
    }

    // Either NAICS code OR PSC code is required
    const hasNaics = formData.naicsCode && formData.naicsCode.trim();
    const hasPsc = formData.pscCode && formData.pscCode.trim();

    if (!hasNaics && !hasPsc) {
      setValidationError('Please enter either a NAICS code or select a PSC code/category');
      return;
    }

    onSubmit(formData as CoreInputs);
  };

  const businessTypes: BusinessType[] = [
    'Women Owned',
    'HUBZone',
    '8(a) Certified',
    'Small Business',
    'DOT Certified',
    'Native American/Tribal',
  ];

  const veteranStatuses: VeteranStatus[] = [
    'Not Applicable',
    'Veteran Owned',
    'Service Disabled Veteran',
  ];

  // PSC Category options for dropdown
  const pscCategories = [
    { value: '', label: 'Select PSC Category...' },
    // Services (A-Z)
    { value: 'D', label: 'D - IT & Telecom Services' },
    { value: 'R', label: 'R - Professional Services' },
    { value: 'J', label: 'J - Maintenance & Repair' },
    { value: 'S', label: 'S - Utilities & Housekeeping' },
    { value: 'Y', label: 'Y - Construction of Structures' },
    { value: 'Z', label: 'Z - Maintenance of Real Property' },
    { value: 'B', label: 'B - Special Studies & Analysis' },
    { value: 'C', label: 'C - Architect & Engineering' },
    { value: 'F', label: 'F - Natural Resources Management' },
    { value: 'G', label: 'G - Social Services' },
    { value: 'H', label: 'H - Quality Control & Testing' },
    { value: 'K', label: 'K - Modification of Equipment' },
    { value: 'L', label: 'L - Technical Representative' },
    { value: 'M', label: 'M - Operation of Facilities' },
    { value: 'N', label: 'N - Installation of Equipment' },
    { value: 'P', label: 'P - Salvage Services' },
    { value: 'Q', label: 'Q - Medical Services' },
    { value: 'T', label: 'T - Photo, Map, Print, Publishing' },
    { value: 'U', label: 'U - Education & Training' },
    { value: 'V', label: 'V - Transportation & Travel' },
    { value: 'W', label: 'W - Lease/Rental of Equipment' },
    { value: 'X', label: 'X - Lease/Rental of Facilities' },
    { value: 'A', label: 'A - R&D Services' },
    // Products/Goods (numeric)
    { value: '70', label: '70 - IT Equipment & Software' },
    { value: '58', label: '58 - Communication Equipment' },
    { value: '65', label: '65 - Medical & Dental Equipment' },
    { value: '66', label: '66 - Instruments & Lab Equipment' },
    { value: '75', label: '75 - Office Supplies' },
    { value: '71', label: '71 - Furniture' },
    { value: '23', label: '23 - Motor Vehicles' },
    { value: '25', label: '25 - Vehicular Equipment' },
    { value: '15', label: '15 - Aircraft & Airframe Components' },
    { value: '59', label: '59 - Electrical Equipment' },
    { value: '36', label: '36 - Special Industry Machinery' },
    { value: '89', label: '89 - Subsistence (Food)' },
    { value: '84', label: '84 - Clothing & Textiles' },
  ];

  return (
    <div className="flex justify-center">
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 max-w-2xl w-full card-hover">
        <div className="mb-4">
          <h2 className="text-2xl font-bold text-slate-100 mb-1">
            Step 1: Enter Your 5 Core Inputs
          </h2>
          <p className="text-sm text-slate-400">
            Provide your business information to discover matching government agencies
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Business Type - Required */}
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-1">
              1. Business Type <span className="text-red-400">*</span>
            </label>
            <select
              value={formData.businessType || ''}
              onChange={(e) => setFormData({ ...formData, businessType: e.target.value as BusinessType })}
              className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded-lg text-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            >
              <option value="">Select your business type...</option>
              {businessTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          {/* NAICS Code and PSC Code - Grid Layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* NAICS Code */}
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-1">
                2. NAICS Code <span className="text-slate-500 text-xs">(or use PSC)</span>
              </label>
              <input
                type="text"
                value={formData.naicsCode || ''}
                onChange={(e) => setFormData({ ...formData, naicsCode: e.target.value })}
                placeholder="e.g., 541330"
                className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded-lg text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="mt-1 text-xs text-slate-500">
                Industry code (e.g., 541330 for Engineering)
              </p>
            </div>

            {/* PSC Code */}
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-1">
                PSC Code <span className="text-slate-500 text-xs">(or use NAICS)</span>
              </label>
              <input
                type="text"
                value={formData.pscCode || ''}
                onChange={(e) => setFormData({ ...formData, pscCode: e.target.value.toUpperCase() })}
                placeholder="e.g., D310, 7030"
                maxLength={4}
                className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded-lg text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="mt-1 text-xs text-slate-500">
                Product/Service Code (4-char)
              </p>
            </div>
          </div>

          {/* Optional Fields - Grid Layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Zip Code - Optional */}
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-1">
                3. Zip Code <span className="text-slate-500 text-xs">(Optional)</span>
              </label>
              <input
                type="text"
                value={formData.zipCode || ''}
                onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                placeholder="e.g., 20001"
                maxLength={5}
                className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded-lg text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Veteran Status - Optional */}
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-1">
                4. Veteran Status <span className="text-slate-500 text-xs">(Optional)</span>
              </label>
              <select
                value={formData.veteranStatus || 'Not Applicable'}
                onChange={(e) => setFormData({ ...formData, veteranStatus: e.target.value as VeteranStatus })}
                className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded-lg text-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {veteranStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* PSC Category and Company Name - Grid Layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* PSC Category Dropdown - Optional */}
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-1">
                5. PSC Category <span className="text-slate-500 text-xs">(Optional)</span>
              </label>
              <select
                value={formData.pscCode || ''}
                onChange={(e) => setFormData({ ...formData, pscCode: e.target.value })}
                className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded-lg text-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {pscCategories.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Company Name - Optional */}
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-1">
                Company Name <span className="text-slate-500 text-xs">(Optional)</span>
              </label>
              <input
                type="text"
                value={formData.companyName || ''}
                onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                placeholder="Your company name"
                className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded-lg text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Exclude DOD Checkbox */}
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            <label className="flex items-start cursor-pointer">
              <input
                type="checkbox"
                checked={formData.excludeDOD || false}
                onChange={(e) => setFormData({ ...formData, excludeDOD: e.target.checked })}
                className="mt-0.5 h-4 w-4 text-amber-500 bg-slate-800 border-slate-600 rounded focus:ring-amber-500"
              />
              <div className="ml-3">
                <span className="text-sm font-semibold text-amber-400">Civilian Agencies Only</span>
                <p className="text-xs text-amber-300/70 mt-0.5">
                  Exclude Department of Defense (DOD) agencies. Civilian agencies are often more accessible for startups and small businesses with simpler procurement processes.
                </p>
              </div>
            </label>
          </div>

          {/* Validation Error */}
          {validationError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start">
              <svg className="w-5 h-5 text-red-400 mt-0.5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-sm text-red-300">{validationError}</span>
            </div>
          )}

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/50 text-white font-semibold py-2.5 px-6 rounded-lg transition-all duration-200 flex items-center justify-center text-sm glow-blue"
            >
              {loading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Finding Target Agencies...
                </>
              ) : (
                <>
                  Find Target Agencies
                  <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </>
              )}
            </button>
          </div>

          {/* Info Box */}
          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3 mt-4">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-cyan-400 mt-0.5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 className="font-semibold text-cyan-300 mb-0.5 text-sm">What happens next?</h3>
                <p className="text-xs text-slate-400">
                  The system will analyze <strong className="text-cyan-400">5,000+ contracts</strong> from USAspending.gov to find agencies that match your profile.
                  You&apos;ll then select which agencies to include in your comprehensive reports.
                </p>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
