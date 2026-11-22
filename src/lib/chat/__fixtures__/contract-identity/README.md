Captured 2026-11-22 from the live Mindy MCP tools (trimmed to the fields Mindy reads). Public federal award data
(USASpending / SAM.gov), no customer data.

- `award-detail-36C24825C0020.json`: get_award_detail(piid 36C24825C0020), the true record (Blue Cord).
- `solicitation-incumbent-36C24825C0020.pre-fix.json`: get_solicitation_incumbent(36C24825C0020) BEFORE the fix,
  which resolved the contract number to solicitation 36C24824R0177 and named Daniels Building Co (36C77624C0154).
- `expiring-va-fl.json`: a get_expiring_contracts result containing the 36C24825C0020 row as the renewal list showed it.
