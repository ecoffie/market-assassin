const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Read the HTML file
const htmlPath = '/Users/ericcoffie/Bootcamp/december-hit-list-general-contractors.html';
const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

// Parse HTML
const dom = new JSDOM(htmlContent);
const document = dom.window.document;

// Extract opportunities
const opportunities = [];
const opportunityCards = document.querySelectorAll('.opportunity-card');

opportunityCards.forEach((card, index) => {
  const numberEl = card.querySelector('.opportunity-number');
  const titleEl = card.querySelector('.opportunity-title');
  const idEl = card.querySelector('.opportunity-id');
  const metaItems = card.querySelectorAll('.meta-item');
  const badges = card.querySelectorAll('.badge-tag');
  const details = card.querySelector('.opportunity-details');

  // Extract deadline
  let deadline = '';
  let type = '';
  let naics = '';

  metaItems.forEach(item => {
    const text = item.textContent;
    if (text.includes('Response Deadline:')) {
      deadline = text.replace('Response Deadline:', '').trim();
    } else if (text.includes('Type:')) {
      type = text.replace('Type:', '').trim();
    } else if (text.includes('NAICS:')) {
      naics = text.replace('NAICS:', '').trim();
    }
  });

  // Extract set-aside
  let setAside = 'Unrestricted';
  let isUrgent = false;

  badges.forEach(badge => {
    const text = badge.textContent.trim();
    if (text.includes('Set-Aside') || text.includes('8(a)') || text.includes('SDVOSB') ||
        text.includes('HUBZone') || text.includes('WOSB') || text.includes('Small Business')) {
      setAside = text;
    }
    if (text.includes('Urgent')) {
      isUrgent = true;
    }
  });

  // Extract project description and POC
  let description = '';
  let poc = '';

  if (details) {
    const paragraphs = details.querySelectorAll('p');
    paragraphs.forEach(p => {
      const text = p.textContent;
      if (text.includes('Project Description:')) {
        description = text.replace('Project Description:', '').trim();
      }
    });

    const actionBox = details.querySelector('.action-box');
    if (actionBox) {
      const actionText = actionBox.textContent;
      const pocMatch = actionText.match(/Contact POC:\s*([^<\n]+)/);
      if (pocMatch) {
        poc = pocMatch[1].trim();
      }
    }
  }

  const noticeId = idEl ? idEl.textContent.replace('Notice ID:', '').trim() : '';

  opportunities.push({
    id: `hit-list-${index + 1}`,
    rank: numberEl ? parseInt(numberEl.textContent) : index + 1,
    title: titleEl ? titleEl.textContent.trim() : '',
    noticeId,
    deadline,
    type,
    naics,
    setAside,
    isUrgent,
    description,
    poc,
    link: `https://sam.gov/opp/${noticeId}/view`,
    category: 'low-competition',
    priority: isUrgent ? 'high' : 'medium'
  });
});

// Create output JSON
const output = {
  metadata: {
    title: 'December 2025 Hit List - Construction Opportunities',
    description: 'Top 25+ low competition construction contracts for general contractors',
    generatedAt: new Date().toISOString(),
    totalOpportunities: opportunities.length,
    source: 'SAM.gov - December 2025 Active Solicitations',
    targetNaics: ['236220', '238210', '238220', '237110', '561210']
  },
  opportunities
};

// Write to JSON file
const outputPath = path.join(__dirname, '../src/data/december-hit-list.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`✅ Extracted ${opportunities.length} opportunities`);
console.log(`📁 Saved to: ${outputPath}`);
console.log('\nSample opportunity:');
console.log(JSON.stringify(opportunities[0], null, 2));
