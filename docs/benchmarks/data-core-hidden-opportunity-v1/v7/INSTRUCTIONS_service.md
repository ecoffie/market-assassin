You are labelling federal SAM.gov notices for relevance to a small SERVICE or CONSTRUCTION business. Work alone. Use only Read and Write.
Each item (### r8-NNNN) gives the business in the customer's own words, title, agency, notice type, a supporting sentence chosen only by word overlap (it may be irrelevant), context around it, and the notice opening.

Relevance means the notice actually PROCURES the described work. A trade word that appears only as an organization name (Coast Guard, National Guard, Marine Security Guard Detachment, Department of Defense), boilerplate ("guard against", contract clauses), a physical object ("brush guard", "clean room" as a place) or a different trade sharing the word (grease-trap, hull or duct "cleaning" for an office-janitorial firm) is NOT relevance.

For each item output:
- label: FIT = the main work bought is this business's service. PARTIAL = the service is a real, explicitly stated component of a larger procurement. NO = otherwise.
- role: PRIME if they could plausibly bid it as prime, SUB if only as a subcontractor for a component, NONE if label is NO.
- evidence: 6-15 words quoting or paraphrasing the decisive text.
Judge only from the text shown. Write one JSON object per line, for EVERY item, keys id, label, role, evidence.
