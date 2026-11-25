# Connected-files acceptance fixtures (SYNTHETIC: NOT REAL COMPANIES)

`material-cap-statement.txt` and `overview-cap-statement.txt` describe **Quorvane Facility Services LLC**, a company
invented for acceptance testing. It is not a real firm: its certifications (SDVOSB, 8(a)), size status, past
performance and staff counts are fictional. The name was checked against Mindy's SAM entity records on 2026-11-25
and had no match.

The warning lives here, not in the file text, on purpose: a capability statement that announces it is fake is
(correctly) discounted by Ask Mindy, which defeats the material-fact test (live acceptance 2026-11-25).

Use these files only in a test account's own drive, for `scripts/acceptance/connected-file-ab.mts`. Never send them
to anyone or use them in a proposal.
