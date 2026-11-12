/**
 * The FAQ shown on the unified pricing surface (/pricing and /mcp/pricing).
 * /pricing mirrors it into FAQPage JSON-LD, so the visible copy and the schema stay one list.
 * Credit numbers are passed in from the server constants — never retype them here.
 */
export function pricingFaqs(c: { signupCredits: number; proCredits: number; teamCredits: number }): { q: string; a: string }[] {
  const n = (x: number) => x.toLocaleString('en-US');
  return [
    {
      q: 'Is there a free trial of Pro?',
      a: `Better — there's a permanent Free tier: a daily digest across 3 NAICS codes plus ${n(c.signupCredits)} MCP credits. Upgrade to Pro for $149/mo when you want full briefings, unlimited NAICS, competitor tracking and recompete alerts. Cancel anytime.`,
    },
    {
      q: 'Can I switch plans later?',
      a: 'Yes, anytime. Upgrade, downgrade, or move to Teams when your second BD person joins. Changes take effect immediately and we pro-rate the difference.',
    },
    {
      q: 'Can I use Mindy inside Claude, Cursor, or my own AI agent?',
      a: `Yes. Every app plan includes credits for Mindy's MCP server: Free gets ${n(c.signupCredits)} one time when you first connect, Pro includes ${n(c.proCredits)} every month, and Teams includes ${n(c.teamCredits)} a month on the billing account. Need more? Credit-only plans start at $99 for 500 credits/mo and work on the same account.`,
    },
    {
      q: 'How do credits work?',
      a: "Each tool call costs a set number of credits. You're charged when Mindy does the research — even a search that honestly finds nothing. You're not charged for refused requests, failures on our side, or calls stopped before they run.",
    },
    {
      q: 'Entry, Mid or Growth — which do I need?',
      a: 'Every plan has the same tools; they differ only in monthly credits. Entry suits occasional use, Mid is the daily driver, Growth covers several markets at once. Need more than that? Email us for an Enterprise pool. Use the plan finder above to size it.',
    },
    {
      q: 'What happens when I run out of credits?',
      a: 'The next call is declined with a top-up message before it runs — you never go negative. Add a $119 top-up (1,000 credits, never expires), upgrade, or wait for renewal.',
    },
    {
      q: 'Do you offer an annual discount?',
      a: 'Yes — two months free on every paid plan. Pro is $1,490/yr instead of $1,788. MCP annual plans also include bonus credits upfront.',
    },
    {
      q: 'What is your refund policy?',
      a: "Payments are final and we don't refund partial months. You can cancel anytime in Settings and keep Pro until the end of the period you paid for. If a technical problem stops you from using what you bought, email admin@getmindy.ai within 7 days of purchase. Try the Free plan first to see if Mindy fits.",
    },
    {
      q: 'What happens to my data if I cancel?',
      a: 'Your account, saved opportunities, NAICS profile and pursuits stay intact for 90 days. After that we anonymize per our privacy policy. Request an export or deletion anytime.',
    },
    {
      q: 'How do you compare to GovWin or Bloomberg Government?',
      a: "Same public federal data — SAM.gov, Grants.gov, USASpending, agency forecasts — in a personalized daily briefing. We skip the enterprise sales motion, which is why it's $149/mo instead of $15,000+/yr.",
    },
  ];
}

/** The /pricing FAQ (Pro / Team / Enterprise, 14-day trial). /pricing mirrors it into FAQPage JSON-LD. */
export function appPricingFaqs(c: { proCredits: number; teamCredits: number }): { q: string; a: string }[] {
  const n = (x: number) => x.toLocaleString('en-US');
  return [
    {
      q: 'How does the 14-day free trial work?',
      a: "Pick Pro or Team and add a card. You get full access for 14 days and pay nothing. Mindy emails you 3 days before the trial ends. Cancel before then and you're never charged.",
    },
    {
      q: 'Can I switch plans later?',
      a: 'Yes, anytime. Move from Pro to Team when your second BD person joins. Changes take effect immediately and we pro-rate the difference.',
    },
    {
      q: 'What are credits?',
      a: `Credits pay for Mindy's research tools, in the app and inside Claude, ChatGPT or Cursor. Pro includes ${n(c.proCredits)} a month and Team includes ${n(c.teamCredits)} a month for the team. Need more? Add a top-up or a credit plan anytime.`,
    },
    {
      q: 'How much do I save with annual billing?',
      a: 'Pro is $1,490 a year instead of $1,788 (17% off). Team is $4,027 a year instead of $5,988 (33% off).',
    },
    {
      q: 'What is your refund policy?',
      a: "You're not charged during the 14-day trial. After that, payments are final and we don't refund partial months. Cancel anytime in Settings and keep access until the end of the period you paid for.",
    },
    {
      q: 'How do you compare to GovWin or Bloomberg Government?',
      a: "Same public federal data — SAM.gov, USASpending, agency forecasts — matched to your business every day. We skip the enterprise sales process, which is why Pro is $149/mo instead of $15,000+/yr.",
    },
  ];
}
