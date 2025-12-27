'use client';

import { useState } from 'react';
import { CoreInputs, BusinessType, VeteranStatus, GoodsOrServices } from '@/types/federal-market-assassin';

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
    goodsOrServices: undefined,
    pscCode: '',
    companyName: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.businessType || !formData.naicsCode) {
      alert('Please fill in all required fields');
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

  const goodsOrServicesOptions: GoodsOrServices[] = [
    'Goods',
    'Services',
    'Both',
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
      <div className="bg-white rounded-xl shadow-lg p-6 max-w-2xl w-full">
        <div className="mb-4">
          <h2 className="text-2xl font-bold text-slate-900 mb-1">
            Step 1: Enter Your 5 Core Inputs
          </h2>
          <p className="text-sm text-slate-600">
            Provide your business information to discover matching government agencies
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Business Type - Required */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              1. Business Type <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.businessType || ''}
              onChange={(e) => setFormData({ ...formData, businessType: e.target.value as BusinessType })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
            {/* NAICS Code - Required */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                2. NAICS Code <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.naicsCode || ''}
                onChange={(e) => setFormData({ ...formData, naicsCode: e.target.value })}
                placeholder="e.g., 541330"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
              <p className="mt-1 text-xs text-slate-500">
                Industry code (e.g., 541330 for Engineering)
              </p>
            </div>

            {/* PSC Code - Optional */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                PSC Code <span className="text-slate-400 text-xs">(Optional - used if no NAICS)</span>
              </label>
              <input
                type="text"
                value={formData.pscCode || ''}
                onChange={(e) => setFormData({ ...formData, pscCode: e.target.value.toUpperCase() })}
                placeholder="e.g., D310, 7030"
                maxLength={4}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                3. Zip Code <span className="text-slate-400 text-xs">(Optional)</span>
              </label>
              <input
                type="text"
                value={formData.zipCode || ''}
                onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                placeholder="e.g., 20001"
                maxLength={5}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Veteran Status - Optional */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                4. Veteran Status <span className="text-slate-400 text-xs">(Optional)</span>
              </label>
              <select
                value={formData.veteranStatus || 'Not Applicable'}
                onChange={(e) => setFormData({ ...formData, veteranStatus: e.target.value as VeteranStatus })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {veteranStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Goods or Services and PSC Category - Grid Layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Goods or Services - Optional */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                5. Goods or Services? <span className="text-slate-400 text-xs">(Optional)</span>
              </label>
              <select
                value={formData.goodsOrServices || ''}
                onChange={(e) => setFormData({ ...formData, goodsOrServices: e.target.value as GoodsOrServices })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Select...</option>
                {goodsOrServicesOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            {/* PSC Category Dropdown - Optional */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                PSC Category <span className="text-slate-400 text-xs">(Optional)</span>
              </label>
              <select
                value={formData.pscCode || ''}
                onChange={(e) => setFormData({ ...formData, pscCode: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {pscCategories.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Company Name - Optional */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Company Name <span className="text-slate-400 text-xs">(Optional)</span>
            </label>
            <input
              type="text"
              value={formData.companyName || ''}
              onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
              placeholder="Your company name"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-2.5 px-6 rounded-lg transition-colors duration-200 flex items-center justify-center text-sm"
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
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-blue-600 mt-0.5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 className="font-semibold text-blue-900 mb-0.5 text-sm">What happens next?</h3>
                <p className="text-xs text-blue-800">
                  The system will analyze <strong>5,000+ contracts</strong> from USAspending.gov to find agencies that match your profile.
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
