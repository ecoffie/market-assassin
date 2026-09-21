-- NAICS vocabulary — the real words federal buyers use, keyed by NAICS/PSC.
-- Mined from live USASpending award (later SOW/PWS) text, cleaned by cross-NAICS
-- TF-IDF (filler that appears everywhere is dropped). One reusable table so every
-- Mindy surface (onboarding keyword ranking, expiring-contract match, forecasts,
-- SOW/PWS relevance, alerts) tests against the ACTUAL vocabulary instead of
-- guessing wildcards. See scripts/build-naics-vocabulary.ts + docs/naics-vocabulary-probe.md.

CREATE TABLE IF NOT EXISTS naics_vocabulary (
  id           BIGSERIAL PRIMARY KEY,
  code         TEXT        NOT NULL,              -- the NAICS (or PSC) code
  code_type    TEXT        NOT NULL DEFAULT 'naics', -- 'naics' | 'psc'
  term         TEXT        NOT NULL,              -- the vocabulary term (word or phrase)
  kind         TEXT        NOT NULL DEFAULT 'word', -- 'word' | 'bigram' | 'trigram'
  weight       REAL        NOT NULL DEFAULT 0,    -- TF-IDF score (higher = more distinctive)
  df           INTEGER     NOT NULL DEFAULT 0,    -- # of awards the term appeared in (in-code)
  source       TEXT        NOT NULL DEFAULT 'usaspending_awards', -- provenance
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One row per (code, code_type, term); re-running the backfill upserts weights.
  UNIQUE (code, code_type, term)
);

-- Primary read path: "give me the vocabulary for NAICS X, best terms first".
CREATE INDEX IF NOT EXISTS idx_naics_vocab_code
  ON naics_vocabulary (code_type, code, weight DESC);

-- Reverse read path: "which codes use term T?" (for SOW/PWS → code inference).
CREATE INDEX IF NOT EXISTS idx_naics_vocab_term
  ON naics_vocabulary (term, weight DESC);
