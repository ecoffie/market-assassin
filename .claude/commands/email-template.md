Create a new email template function in `/src/lib/send-email.ts` for a product.

Follow the Email Template Standard from CLAUDE.md:
- Footer: "GovCon Giants AI"
- Support: service@govcongiants.com
- Phone: 786-477-0477
- Include activation link to `/activate`
- Include "Manage preferences" and "Unsubscribe" links
- Branded HTML with navy header (#1a365d), blue accents (#3182ce)
- Plain text fallback version
- Function name pattern: `send{ProductName}Email(email: string, name?: string)`

Product: $ARGUMENTS

Ask me what the email should say (welcome message, what they get access to, next steps), then generate the function.
