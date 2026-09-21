-- DoD Critical Technology Area (CTA) filters — NAPEX 2026 wedge
-- Reference: tasks/PRD-cta-filters.md, funding-levers-research.md §1.3

CREATE TABLE IF NOT EXISTS cta_codes (
  cta_id          TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  short_name      TEXT NOT NULL,
  description     TEXT NOT NULL,
  naics_anchors   TEXT[] NOT NULL DEFAULT '{}',
  keywords        TEXT[] NOT NULL DEFAULT '{}',
  priority_order  INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opportunity_cta_tags (
  notice_id     TEXT NOT NULL REFERENCES sam_opportunities(notice_id) ON DELETE CASCADE,
  cta_id        TEXT NOT NULL REFERENCES cta_codes(cta_id) ON DELETE CASCADE,
  confidence    TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  match_source  TEXT NOT NULL CHECK (match_source IN ('naics', 'keyword_title', 'keyword_description', 'manual')),
  tagged_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notice_id, cta_id)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_cta_tags_cta
  ON opportunity_cta_tags (cta_id, notice_id);

CREATE INDEX IF NOT EXISTS idx_opportunity_cta_tags_notice
  ON opportunity_cta_tags (notice_id);

-- Resumable backfill checkpoint (null = not yet tagged by rules job)
ALTER TABLE sam_opportunities
  ADD COLUMN IF NOT EXISTS cta_tagged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sam_opps_cta_tagged_at
  ON sam_opportunities (cta_tagged_at NULLS FIRST)
  WHERE active = true;

-- Seed 14 DoD Critical Technology Areas (research-derived; OSBP validation Phase 2)
INSERT INTO cta_codes (cta_id, name, short_name, description, naics_anchors, keywords, priority_order) VALUES
  ('trusted_ai', 'Trusted AI & Autonomy', 'Trusted AI',
   'Artificial intelligence, machine learning, and autonomous systems for defense applications.',
   ARRAY['541511','541512','541715'],
   ARRAY['artificial intelligence','machine learning','autonomy','autonomous systems','computer vision'], 1),
  ('biotechnology', 'Biotechnology', 'Biotech',
   'Biomanufacturing, synthetic biology, and biodefense-related life sciences.',
   ARRAY['325414','541714','621511'],
   ARRAY['biotechnology','biomanufacturing','synthetic biology','biodefense'], 2),
  ('quantum', 'Quantum Science', 'Quantum',
   'Quantum computing, sensing, and communications technologies.',
   ARRAY['541713','541715'],
   ARRAY['quantum computing','quantum sensing','quantum communications','quantum'], 3),
  ('microelectronics', 'Microelectronics', 'Microelectronics',
   'Semiconductor design, fabrication, ASIC/FPGA, and chip supply chain.',
   ARRAY['334413','334419'],
   ARRAY['microelectronics','semiconductor','chip fabrication','asic','fpga'], 4),
  ('space_tech', 'Space Technology', 'Space',
   'Satellites, launch vehicles, orbital systems, and spacecraft.',
   ARRAY['336414','336415','541713'],
   ARRAY['satellite','launch vehicle','orbital','spacecraft','space technology'], 5),
  ('advanced_materials', 'Advanced Materials', 'Adv. Materials',
   'Composites, nanomaterials, metamaterials, and novel material science.',
   ARRAY['325','331','332'],
   ARRAY['advanced materials','composites','nanomaterials','metamaterials'], 6),
  ('hypersonics', 'Hypersonics', 'Hypersonics',
   'Hypersonic flight, scramjet propulsion, and high-speed strike systems.',
   ARRAY['336414','541330','541713'],
   ARRAY['hypersonic','scramjet','high-speed flight'], 7),
  ('directed_energy', 'Directed Energy', 'Directed Energy',
   'High-energy lasers, microwave weapons, and directed-energy systems.',
   ARRAY['333611','334516','541330'],
   ARRAY['directed energy','high energy laser','hel','microwave weapon'], 8),
  ('integrated_sensing_cyber', 'Integrated Sensing & Cyber', 'Cyber & Sensing',
   'Cyber defense, ISR, RF sensing, and integrated sensing architectures.',
   ARRAY['334290','541512','541519'],
   ARRAY['cybersecurity','cyber defense','isr','integrated sensing'], 9),
  ('futureg', 'Future-Generation Wireless (FutureG)', 'FutureG',
   '5G/6G, next-generation wireless, and millimeter-wave communications.',
   ARRAY['334210','334290','517111'],
   ARRAY['5g','6g','next-gen wireless','futureg','mmwave'], 10),
  ('renewable_energy', 'Renewable Energy Generation & Storage', 'Renewable Energy',
   'Battery storage, grid storage, solar, wind, and renewable generation.',
   ARRAY['221114','221115','335999'],
   ARRAY['renewable energy','battery storage','grid storage','solar','wind energy'], 11),
  ('advanced_computing', 'Advanced Computing & Software', 'Adv. Computing',
   'HPC, edge computing, supercomputing, and advanced software systems.',
   ARRAY['511210','541511','541512'],
   ARRAY['high-performance computing','hpc','edge computing','supercomputing'], 12),
  ('human_machine', 'Human-Machine Interfaces', 'HMI',
   'AR/VR, neurotech, and human-machine interface systems.',
   ARRAY['334118','334290','541330'],
   ARRAY['human-machine interface','hmi','augmented reality','virtual reality','neurotech'], 13),
  ('network_systems', 'Integrated Network Systems-of-Systems', 'Net Systems',
   'C4ISR, JADC2, battle management, and mesh network architectures.',
   ARRAY['334290','334418','541330'],
   ARRAY['command and control','c4isr','jadc2','battle management','mesh network'], 14)
ON CONFLICT (cta_id) DO UPDATE SET
  name = EXCLUDED.name,
  short_name = EXCLUDED.short_name,
  description = EXCLUDED.description,
  naics_anchors = EXCLUDED.naics_anchors,
  keywords = EXCLUDED.keywords,
  priority_order = EXCLUDED.priority_order;

COMMENT ON TABLE cta_codes IS 'DoD 14 Critical Technology Areas — NAPEX CTA filter dimension';
COMMENT ON TABLE opportunity_cta_tags IS 'Rules-based CTA tags on cached SAM opportunities';
