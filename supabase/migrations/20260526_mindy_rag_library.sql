-- Mindy RAG Library — Eric Coffie's 8-year teaching corpus
--
-- Indexes all of Eric's federal contracting teaching material so
-- Mindy's AI outputs cite real templates / past performance examples
-- / teaching frameworks instead of generic LLM defaults.
--
-- Source: ~/Action Plan/ folder + ~/ebooks/03 Ask Eric Coffie/
-- (~1,843 text documents: md, txt, pdf, docx, pptx)
--
-- Per Eric 2026-05-26: 'goldmine of data and feedback' — 8 years of
-- teaching federal contracts. RAG turns this into Mindy's permanent
-- competitive moat. Competitors can copy features, not 8 years of
-- domain pedagogy.
--
-- Architecture:
--   mindy_rag_documents  — one row per source file
--   mindy_rag_chunks     — chunked passages for similarity search
--                          (added in Day 2 with pgvector)

CREATE TABLE IF NOT EXISTS mindy_rag_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- File provenance
  source_path TEXT NOT NULL UNIQUE,    -- absolute path on disk
  filename TEXT NOT NULL,
  file_extension TEXT NOT NULL,         -- 'md' | 'txt' | 'pdf' | 'docx' | 'pptx'
  size_bytes BIGINT,
  file_mtime TIMESTAMPTZ,               -- file's last-modified time on disk
  file_sha256 TEXT,                     -- to detect unchanged files on re-ingest

  -- Auto-classified document type (heuristic from folder path + content)
  doc_type TEXT,                        -- 'cap_statement' | 'proposal_template' |
                                        -- 'past_performance' | 'teaching_handout' |
                                        -- 'course_material' | 'slide_deck' |
                                        -- 'webinar_resource' | 'planner_app_code' |
                                        -- 'qa_dataset' | 'ebook' | 'misc'

  -- Folder context
  top_level_folder TEXT,                -- 'The Vault' | 'courses' | 'resources' | etc.
  folder_path TEXT,                     -- relative path under ~/Action Plan/

  -- Extracted content
  title TEXT,                           -- best-guess title (filename or first H1)
  full_text TEXT,                       -- extracted plaintext
  text_length INT,                      -- char count for quick sizing
  page_count INT,                       -- for PDF/docx
  word_count INT,

  -- AI-extracted metadata (filled in Day 2 by a metadata pass)
  topic_tags TEXT[] DEFAULT ARRAY[]::TEXT[],   -- e.g. ['sources-sought', 'cap-statement', '8a']
  related_naics TEXT[] DEFAULT ARRAY[]::TEXT[],
  one_line_summary TEXT,
  has_pii BOOLEAN DEFAULT false,        -- flag if found names/UEIs/etc; quarantines from retrieval
  usage_rights TEXT DEFAULT 'eric_owned',  -- 'eric_owned' | 'client_quarantine' | 'review_needed'

  -- Ingestion lifecycle
  ingestion_status TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' | 'extracted' | 'embedded' | 'failed' | 'skipped'
  ingestion_error TEXT,
  ingested_at TIMESTAMPTZ,
  embedded_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_docs_status ON mindy_rag_documents(ingestion_status);
CREATE INDEX IF NOT EXISTS idx_rag_docs_doctype ON mindy_rag_documents(doc_type) WHERE has_pii = false;
CREATE INDEX IF NOT EXISTS idx_rag_docs_folder ON mindy_rag_documents(top_level_folder);
CREATE INDEX IF NOT EXISTS idx_rag_docs_tags ON mindy_rag_documents USING GIN (topic_tags);
CREATE INDEX IF NOT EXISTS idx_rag_docs_naics ON mindy_rag_documents USING GIN (related_naics);

COMMENT ON TABLE mindy_rag_documents IS
  'Eric Coffie teaching corpus — Day 1 ingestion populates one row per file from ~/Action Plan/ + ~/ebooks/03 Ask Eric Coffie/. Source of truth for everything Mindy retrieves during draft generation.';

NOTIFY pgrst, 'reload schema';
