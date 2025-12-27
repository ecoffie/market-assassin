# 🎯 Federal Market Assassin

**The Ultimate Government Contracting Intelligence System**

A Next.js application that generates comprehensive market reports from 5 core inputs → Select target agencies → Get all 8 strategic reports instantly.

---

## 🚀 Overview

Federal Market Assassin is a powerful intelligence system that transforms your business profile into actionable government contracting strategies. Enter 5 core inputs, select your target agencies, and receive **8 comprehensive reports** with smart suggestions for primes, tribes, and additional agencies based on pain point analysis.

### Key Features

- **🎯 Precision Targeting** - Analyzes 5,000+ contracts from USAspending.gov
- **📊 8 Comprehensive Reports** - All generated simultaneously
- **🧠 Smart Intelligence** - AI-powered prime, tribe, and agency suggestions
- **⚡ Lightning Fast** - Built with Next.js 14 and TypeScript
- **📱 Responsive Design** - Beautiful UI with Tailwind CSS

---

## 📋 The 8 Reports

1. **👥 Government Buyers Report** - Identify contracting officers and decision makers
2. **🔗 Tier 2 Subcontracting Report** - Find prime contractors seeking partners
3. **📅 Forecast List Report** - Discover upcoming contract opportunities
4. **🎯 Agency Needs Report** - Match capabilities to agency requirements
5. **💡 Agency Pain Points Report** - Position solutions to agency challenges
6. **💰 December Spend Forecast** - Identify Q4 opportunities
7. **🏛️ Tribal Contracting Report** - Find tribal business opportunities
8. **⭐ Prime Contractor Report** - Connect with prime contractors

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ installed
- npm or yarn package manager

### Installation

1. **Navigate to the project directory:**
   ```bash
   cd market-assassin
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run the development server:**
   ```bash
   npm run dev
   ```

4. **Open your browser:**
   Navigate to [http://localhost:3000/federal-market-assassin](http://localhost:3000/federal-market-assassin)

---

## 🎯 How to Use

### Step 1: Enter Your 5 Core Inputs

Visit `/federal-market-assassin` and provide:

1. **Business Type** (Required)
   - Women Owned, HUBZone, 8(a) Certified, Small Business, DOT Certified, or Native American/Tribal

2. **NAICS Code** (Required)
   - Your primary industry code (e.g., 541330)

3. **Zip Code** (Optional)
   - Your location for geographic targeting

4. **Veteran Status** (Optional)
   - Veteran Owned, Service Disabled Veteran, or Not Applicable

5. **Goods or Services?** (Optional)
   - Goods, Services, or Both

6. **Company Name** (Optional)

### Step 2: Review Target Agencies

The system analyzes contracts from USAspending.gov and displays matching agencies with:
- Agency Name and Parent Agency
- Set-Aside Spending
- Contract Count
- Location

**Quick Selection Options:**
- Select Top 10, Top 20, or All agencies
- Or custom select individual agencies

### Step 3: Generate All 8 Reports

Click "Generate All 8 Reports" to receive comprehensive market intelligence with:
- Executive summaries
- Detailed findings
- Smart suggestions (primes, tribes, agencies)
- Strategic recommendations
- Action items

### Step 4: Export & Use

- **Export as PDF** - Print or save reports
- **Export as JSON** - Use data in other systems
- Use reports for outreach, proposals, and strategic planning

---

## 🏗️ Project Structure

```
market-assassin/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── usaspending/        # USAspending.gov API integration
│   │   │   ├── reports/            # Report generation endpoints
│   │   │   └── pain-points/        # Pain points matching
│   │   └── federal-market-assassin/
│   │       └── page.tsx            # Main application page
│   ├── components/
│   │   └── federal-market-assassin/
│   │       ├── forms/
│   │       │   └── CoreInputForm.tsx      # 5 inputs form
│   │       ├── tables/
│   │       │   └── AgencySelectionTable.tsx  # Agency selection
│   │       └── reports/
│   │           └── ReportsDisplay.tsx     # Reports display
│   ├── lib/
│   │   ├── api/                    # API utilities
│   │   ├── utils/                  # Helper functions
│   │   └── algorithms/             # Smart matching algorithms
│   ├── types/
│   │   └── federal-market-assassin.ts  # TypeScript types
│   └── data/                       # Static data (pain points, etc.)
├── public/                         # Static assets
└── README.md                       # This file
```

---

## 🛠️ Current Implementation Status

### ✅ Completed

- [x] Next.js 14 project setup with TypeScript
- [x] Project folder structure
- [x] TypeScript type definitions for all 8 reports
- [x] Core Input Form (5 inputs)
- [x] Agency Selection Table with sorting
- [x] Reports Display component with tabs
- [x] Export functionality (PDF/JSON)
- [x] Responsive UI with Tailwind CSS
- [x] **Bootcamp Database Integration**
  - [x] Prime Contractors Database (3,502 contractors)
  - [x] Tier 2 Contractors Database (207 contractors)
  - [x] Tribal Businesses Database (800+ businesses)
  - [x] December Spend Forecast Database (58+ Q4 opportunities)
- [x] **Report Generation Logic**
  - [x] Tier 2 Subcontracting Report (using prime contractors database)
  - [x] Tribal Contracting Report (using tribal businesses database)
  - [x] Prime Contractor Report (using prime contractors database)
  - [x] Agency Pain Points Report (using pain points database)
  - [x] December Spend Forecast Report (using December spend forecast database, filtered by 5 core inputs)
- [x] **Smart Suggestions Engine**
  - [x] Prime contractor suggestions by NAICS, agency, and pain points
  - [x] Tribal business suggestions for subcontracting and teaming
  - [x] Agency pain point matching algorithm
  - [x] Similar agencies recommendations

### 🚧 In Progress / To Be Implemented

- [ ] USAspending.gov API integration (partially implemented)
- [ ] Government Buyers Report (needs enhancement with real data)
- [ ] Forecast List Report (needs data source integration)
- [ ] Agency Needs Report (needs data source integration)

---

## 🔌 API Endpoints

### Find Agencies
```
POST /api/usaspending/find-agencies
```
**Request Body:**
```json
{
  "businessType": "Women Owned",
  "naicsCode": "541330",
  "zipCode": "20001",
  "veteranStatus": "Not Applicable",
  "goodsOrServices": "Services"
}
```

### Generate Reports
```
POST /api/reports/generate-all
```
**Request Body:**
```json
{
  "inputs": { ... },
  "selectedAgencies": ["agency-id-1", "agency-id-2"]
}
```

---

## 🧠 Smart Suggestions Engine

The system provides intelligent suggestions using the bootcamp databases:

### Prime Contractors (3,502+ contractors)
- **By NAICS Code** - Industry-specific primes from comprehensive database
- **By Pain Points** - Primes solving agency challenges (verified from contract data)
- **By Target Agencies** - Primes working with your agencies (verified relationships)
- **Real Contact Information** - SBLO names, emails, phones, and supplier portal URLs

### Tribal Businesses (800+ businesses for subcontracting & teaming)
- **By NAICS Code** - Find tribal partners in your industry
- **By Geographic Region** - Partner with businesses in relevant locations
- **By Capabilities** - Match complementary capabilities for teaming
- **By Certification** - 8(a), HUBZone, WOSB certified partners
- **Real Contact Information** - Contact person names and emails for outreach

### Other Agencies
- **By Pain Points** - Agencies with similar challenges (using pain points database)
- **By Capabilities** - Agencies needing your expertise
- **By Strategic Fit** - Agencies complementing your targets

---

## 📊 Technology Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **API Integration:** USAspending.gov API
- **Data Processing:** Server-side with Next.js API routes

## 📚 Data Sources & Databases

### Bootcamp Databases (Integrated)
- **Prime Contractors Database** - 3,502 prime contractors with:
  - SBLO contact information (name, email, phone)
  - Supplier portal URLs and registration instructions
  - Contract history (counts, values, performance)
  - NAICS categories and target agencies
  - Subcontract plan status
  
- **Tier 2 Contractors Database** - 207 tier 2 subcontractors with:
  - Contact information and quality indicators
  - NAICS categories
  - Source tracking

- **Tribal Businesses Database** - 800+ Native American/Tribal businesses with:
  - Contact information (names, emails)
  - SBA certifications (8(a), HUBZone, WOSB, etc.)
  - Capabilities and narratives
  - NAICS codes and geographic data
  - Use case: Subcontracting and teaming partnerships

### Other Data Sources
- **Agency Pain Points Database** - Comprehensive pain points for federal agencies
- **Component Agency Rules** - Agency identification and mapping
- **USAspending.gov API** - Contract and spending data

---

## 🎯 Next Steps for Development

1. **Enhance USAspending.gov API Integration**
   - ✅ Basic integration implemented
   - [ ] Add caching for performance
   - [ ] Implement pagination for large result sets
   - [ ] Add error handling and retry logic

2. **Complete Remaining Report Generators**
   - ✅ Tier 2 Subcontracting Report (using bootcamp database)
   - ✅ Tribal Contracting Report (using bootcamp database)
   - ✅ Prime Contractor Report (using bootcamp database)
   - ✅ Agency Pain Points Report (using pain points database)
   - ✅ December Spend Forecast Report (using bootcamp database, filtered by 5 core inputs)
   - [ ] Government Buyers Report (enhance with real agency data)
   - [ ] Forecast List Report (integrate forecast data sources)
   - [ ] Agency Needs Report (integrate strategic plan data)

3. **Smart Suggestions Engine** ✅
   - ✅ Prime contractor suggestions (3,502+ contractors)
   - ✅ Tribal business suggestions (800+ businesses)
   - ✅ Agency pain point matching
   - ✅ Similar agencies recommendations

4. **Database Integration** ✅
   - ✅ Bootcamp Prime Contractors Database (3,502 records)
   - ✅ Bootcamp Tier 2 Contractors Database (207 records)
   - ✅ Bootcamp Tribal Businesses Database (800+ records)
   - ✅ Bootcamp December Spend Forecast Database (58+ opportunities)
   - ✅ Pain Points Database integration
   - ✅ Component Agency Rules integration

5. **Testing & Optimization**
   - [ ] Test report generation with various inputs
   - [ ] Optimize database query performance
   - [ ] Add comprehensive error handling
   - [ ] Add input validation

---

## 🤝 Contributing

This is a private project. For questions or issues, contact the development team.

---

## 📝 License

Proprietary - All rights reserved

---

## 📞 Support

For questions about Federal Market Assassin:
- Review the documentation in `/FEDERAL_MARKET_ASSASIN.md`
- Check the implementation guide
- Contact the development team

---

## 🏆 Why "Federal Market Assassin"?

Just like an assassin is precise, strategic, and effective - Federal Market Assassin:

- **Precise Targeting** - Identifies exact agencies matching your profile
- **Strategic Intelligence** - Provides comprehensive market analysis
- **Effective Execution** - Delivers actionable recommendations
- **Lethal Accuracy** - Matches capabilities to opportunities

**You're not just bidding on contracts - you're strategically targeting agencies with precision.**

---

**Federal Market Assassin - Your Strategic Advantage in Government Contracting**

*Enter 5 inputs. Select agencies. Dominate the market.*
