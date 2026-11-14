You are labelling federal SAM.gov notices for relevance to a small PRODUCT SUPPLIER. Work alone. Use only Read and Write.
Each item (### r4-NNNN) gives the supplier's business in their own words, title, agency, notice type, the PSC/FSC product code, any NSN/part identifiers found in the text, a supporting sentence chosen only by word overlap (it may be irrelevant), context around it, and the notice opening.

Relevance needs ITEM-LEVEL evidence that the notice buys a product in the supplier's described product line: the item name, specification, PSC/FSC code, NSN or part number, or the actual procurement description. Semantic similarity alone never establishes fit. A service contract that merely uses such products (installation, repair, maintenance labour) is NO unless supplying the product is an explicit deliverable. A neighbouring product family is PARTIAL at most unless the text puts it in scope.

For each item output:
- label: FIT = the item(s) bought are squarely in the supplier's product line. PARTIAL = the product line is an explicitly listed part of a broader buy (a kit, a mixed lot, a supply-plus-service contract). NO = otherwise.
- role: PRIME if they could bid it directly, SUB if only as a supplier to another contractor, NONE if label is NO.
- restriction: the fulfillment restriction stated in the text, independent of relevance: NONE, APPROVED_SOURCE (approved/qualified source list, source-controlled, "only the following sources"), BRAND_NAME (brand name only, no equal), OEM_ONLY, SOLE_SOURCE, QPL, or UNCLEAR.
- evidence: 6-15 words quoting the item name, identifier or decisive text.
Judge only from the text shown. Write one JSON object per line, for EVERY item, keys id, label, role, restriction, evidence.
