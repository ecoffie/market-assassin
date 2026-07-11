# Keyword Derivation — DSBS-grounded test report

_Ground truth = the vocabulary of real top-value winning awards per NAICS (live USASpending) — Eric's "copy successful firms' keywords" method, made measurable._

## Headline metrics

**Sample:** 51 cases across 10 industries (2-word → full-sentence phrasings).

| Metric | Score | What it means |
|---|---|---|
| **Defining term present** | **100%** | Our keywords contain the industry's defining word (e.g. "welding"). Binary, trustworthy — the keyword-quality gate. |
| **Lead NAICS correct** | **65%** | The profile's #1 NAICS is the expected trade code. The 236220-over-238220 class of bug. |
| Keyword recall (directional) | 63% | Share of our keyword words found in raw award text. NOISY — award text is project-verb-heavy; a right keyword can be absent. Trend only. |

> **Read the two bold rows.** "Defining term present" and "Lead NAICS correct" are the real signals. Keyword recall is directional (award descriptions are noisy).

## ⚠️ Wrong lead NAICS (18)

| Industry | Phrasing | Got | Expected |
|---|---|---|---|
| roofing | roof replacement waterproofing | 237990 | 238160 / 236220 |
| roofing | we do commercial roofing replacement and wat | 237990 | 238160 / 236220 |
| electrical | electrical wiring installation | 541330 | 238210 / 236220 |
| nurse-staffing | medical staffing | 524114 | 561320 / 621399 / 622110 |
| nurse-staffing | we supply registered nurses and medical staf | 524114 | 561320 / 621399 / 622110 |
| landscaping | landscaping | 562119 | 561730 |
| landscaping | grounds maintenance | 562119 | 561730 |
| landscaping | lawn and grounds maintenance | 562119 | 561730 |
| landscaping | landscaping and grounds maintenance services | 562119 | 561730 |
| landscaping | we provide landscaping, mowing and grounds m | 562119 | 561730 |
| pest-control | pest control | 334511 | 561710 |
| pest-control | termite and pest control | 334511 | 561710 |
| pest-control | pest control and extermination services | 334511 | 561710 |
| welding | welding | 336611 | 332710 / 238120 / 333514 |
| welding | metal fabrication | 331410 | 332710 / 238120 / 333514 |
| welding | welding and fabrication | 541715 | 332710 / 238120 / 333514 |
| welding | welding and metal fabrication | 331410 | 332710 / 238120 / 333514 |
| welding | we do custom welding, machining and metal fa | 331410 | 332710 / 238120 / 333514 |

## Full results

### hvac

| Phrasing | Lead | ok | Defining | Recall | Keywords |
|---|---|---|---|---|---|
| hvac | 236220 | ✓ | ✓ | 100% | hvac services, hvac services hvac, hvac hvac, hvac, hvac hvac repair, hvac repair |
| commercial hvac | 236220 | ✓ | ✓ | 100% | commercial hvac, commercial hvac commercial, commercial hvac hvac, hvac commercial hvac, hvac commercial, hvac hvac |
| hvac installation service | 236220 | ✓ | ✓ | 100% | hvac installation, hvac installation hvac, installation service hvac, installation hvac installation, installation hvac, hvac repair |
| air conditioning repair | 238220 | ✓ | ✓ | 100% | air conditioning repair, repair air conditioning, air conditioning, conditioning repair air, conditioning |
| we install and service commercial HVAC systems for | 236220 | ✓ | ✓ | 100% | commercial hvac installation, commercial hvac, hvac installation, buildings hvac repair, buildings hvac, hvac |
| heating ventilation and air conditioning contracto | 238220 | ✓ | ✓ | 67% | heating ventilation, air conditioning heating, chiller and boiler, conditioning heating ventilation, conditioning contractor doing, doing chiller |

### janitorial

| Phrasing | Lead | ok | Defining | Recall | Keywords |
|---|---|---|---|---|---|
| janitorial | 561720 | ✓ | ✓ | 100% | janitorial, janitorial janitorial, janitorial janitorial janitorial, janitorial janitorial housekeeping, janitorial housekeeping, custodial janitorial |
| commercial janitorial | 561720 | ✓ | ✓ | 100% | commercial janitorial, commercial janitorial commercial, commercial janitorial janitorial, janitorial commercial janitorial, janitorial commercial, janitorial janitorial |
| custodial cleaning services | 561720 | ✓ | ✓ | 100% | custodial cleaning services, cleaning services custodial, custodial housekeeping custodial, custodial cleaning, custodial janitorial, custodial janitorial janitorial |
| janitorial and custodial services in Florida | 561720 | ✓ | ✓ | 80% | janitorial and custodial services, florida janitorial, florida janitorial housekeeping, janitorial and custodial, custodial services janitorial, janitorial housekeeping custodial |
| we provide commercial janitorial and custodial cle | 561720 | ✓ | ✓ | 100% | commercial janitorial, buildings janitorial, custodial janitorial facilities, buildings janitorial housekeeping, housekeeping custodial janitorial, janitorial and custodial |

### roofing

| Phrasing | Lead | ok | Defining | Recall | Keywords |
|---|---|---|---|---|---|
| roofing | 238160 | ✓ | ✓ | 100% | roofing, roofing roofing, roofing roofing roofing, roofing roofing repair, roofing repair |
| commercial roofing | 238160 | ✓ | ✓ | 100% | commercial roofing, commercial roofing commercial, roofing commercial roofing, commercial roofing roofing, roofing commercial, roofing roofing |
| roof replacement waterproofing | 237990 | ✗ | ✓ | 50% | roof replacement waterproofing, waterproofing roof replacement, replacement waterproofing replacement, roof replacement, waterproofing replacement, replacement waterproofing roof |
| commercial roofing and waterproofing | 238160 | ✓ | ✓ | 50% | commercial roofing and waterproofing, roofing and waterproofing, waterproofing commercial roofing, commercial roofing, waterproofing commercial, waterproofing roofing |
| we do commercial roofing replacement and waterproo | 237990 | ✗ | ✓ | 50% | commercial roofing replacement, roofing replacement, commercial roofing, replacement and waterproofing, roofing, replacement |

### electrical

| Phrasing | Lead | ok | Defining | Recall | Keywords |
|---|---|---|---|---|---|
| electrical | 236220 | ✓ | ✓ | 50% | electrical contracting, electrical contracting electrical, electrical contracting construction, contracting electrical contracting, contracting electrical, electrical |
| electrical contractor | 236220 | ✓ | ✓ | 50% | electrical contracting, electrical contracting electrical, electrical contractor contracting, contracting electrical, electrical |
| electrical wiring installation | 541330 | ✗ | ✓ | 33% | electrical wiring installation, wiring installation electrical, wiring installation, installation electrical wiring, electrical wiring, installation electrical |
| electrical contracting for military bases | 236220 | ✓ | ✓ | 25% | electrical contracting, electrical contracting electrical, contracting electrical contracting, military bases contracting, contracting electrical, contracting for military |
| licensed electrical contractor performing wiring,  | 236220 | ✓ | ✓ | 20% | electrical contracting, electrical contracting licensed, electrical contractor performing, contracting licensed electrical, licensed electrical, facilities contracting |

### security-guard

| Phrasing | Lead | ok | Defining | Recall | Keywords |
|---|---|---|---|---|---|
| security guard | 561612 | ✓ | ✓ | 75% | security guard, security guard security, guard security guard, guard security, security guard housekeeping, guard security facilities |
| armed security | 561612 | ✓ | ✓ | 100% | armed security, armed security armed, security armed security, security armed, armed |
| armed guard services | 561612 | ✓ | ✓ | 60% | armed guard services, guard services armed, guard services guard, armed guard, guard security institutional, guard security |
| armed security guard services | 561612 | ✓ | ✓ | 75% | armed security guard services, armed security guard, guard services armed, armed security, guard services guard, guard security institutional |
| we provide armed and unarmed security guard servic | 561612 | ✓ | ✓ | 50% | security guard services, guard security institutional, security guard, unarmed security guard, guard security, security institutional facilities |

### it-support

| Phrasing | Lead | ok | Defining | Recall | Keywords |
|---|---|---|---|---|---|
| help desk | 541519 | ✓ | ✓ | 25% | help desk, help desk help, user help desk, desk help desk, help desk tier, help |
| it support | 541512 | ✓ | ✓ | 0% | it support, infrastructure support professional, professional other computer |
| network help desk | 541512 | ✓ | ✓ | 33% | network help desk, help desk network, help desk, desk network help, desk network, network help |
| IT help desk and network support | 541512 | ✓ | ✓ | 33% | help desk, desk and network, network support network, help, desk, network |
| we provide tier 1 and tier 2 IT help desk, desktop | 541519 | ✓ | ✓ | 20% | it help desk support, help desk tier, user help desk, desk tier 1-2, help desk, help desk desktop |

### nurse-staffing

| Phrasing | Lead | ok | Defining | Recall | Keywords |
|---|---|---|---|---|---|
| nurse staffing | 622110 | ✓ | ✓ | 100% | nurse staffing, nurse staffing nurse, staffing nurse staffing, staffing nurse, staffing nurse medical, nurse |
| medical staffing | 524114 | ✗ | ✓ | 100% | medical staffing, medical staffing medical, staffing medical staffing, staffing medical, staffing medical medical, medical |
| registered nurse staffing | 622110 | ✓ | ✓ | 100% | registered nurse staffing, nurse staffing registered, staffing registered nurse, nurse staffing, staffing registered, registered nurse |
| nurse staffing for VA hospitals | 622110 | ✓ | ✓ | 67% | nurse staffing, nurse staffing nurse, staffing nurse staffing, staffing nurse, nurse, hospitals |
| we supply registered nurses and medical staffing t | 524114 | ✗ | ✓ | 50% | medical staffing, nurses and medical, treatment facilities medical, hospitals and military, military treatment facilities, registered |

### landscaping

| Phrasing | Lead | ok | Defining | Recall | Keywords |
|---|---|---|---|---|---|
| landscaping | 562119 | ✗ | ✓ | 25% | landscaping, landscaping landscaping, landscaping landscaping landscaping, landscaping housekeeping landscaping, landscaping landscaping housekeeping, landscaping groundskeeping |
| grounds maintenance | 562119 | ✗ | ✓ | 50% | grounds maintenance, grounds maintenance grounds, maintenance grounds maintenance, housekeeping landscaping groundskeeping, maintenance grounds, maintenance grounds housekeeping |
| lawn and grounds maintenance | 562119 | ✗ | ✓ | 40% | lawn and grounds maintenance, lawn and grounds, grounds maintenance lawn, housekeeping landscaping groundskeeping, grounds maintenance grounds, landscaping groundskeeping |
| landscaping and grounds maintenance services | 562119 | ✗ | ✓ | 40% | landscaping and grounds maintenance, landscaping and grounds, landscaping groundskeeping, housekeeping landscaping groundskeeping, grounds maintenance landscaping, landscaping housekeeping landscaping |
| we provide landscaping, mowing and grounds mainten | 562119 | ✗ | ✓ | 33% | landscaping and grounds maintenance, landscaping groundskeeping, landscaping and grounds, mowing and grounds, housekeeping landscaping groundskeeping, landscaping mowing |

### pest-control

| Phrasing | Lead | ok | Defining | Recall | Keywords |
|---|---|---|---|---|---|
| pest control | 334511 | ✗ | ✓ | 100% | pest control, pest control pest, pest control control, control pest control, control pest, pest |
| pest management | 561710 | ✓ | ✓ | 100% | pest management, pest management pest, pest |
| termite and pest control | 334511 | ✗ | ✓ | 100% | termite and pest control, termite and pest, pest control termite, control termite, termite, pest control |
| pest control and extermination services | 334511 | ✗ | ✓ | 67% | pest control, extermination services pest, extermination services control, pest, control, extermination |
| we provide integrated pest management and extermin | 561710 | ✓ | ✓ | 56% | integrated pest management, integrated pest, facilities pest, facilities pest housekeeping, insect rodent control, rodent control exterminating |

### welding

| Phrasing | Lead | ok | Defining | Recall | Keywords |
|---|---|---|---|---|---|
| welding | 336611 | ✗ | ✓ | 0% | welding, welding welding, welding welding welding, welding welding non-nuclear, welding non-nuclear |
| metal fabrication | 331410 | ✗ | ✓ | 33% | metal fabrication, metal fabrication metal, fabrication metal fabrication, fabrication metal, fabrication metal precious, metal |
| welding and fabrication | 541715 | ✗ | ✓ | 50% | welding and fabrication, fabrication welding, welding, fabrication fabrication, fabrication |
| welding and metal fabrication | 331410 | ✗ | ✓ | 25% | welding and metal fabrication, welding and metal, metal fabrication welding, fabrication welding, metal fabrication, metal fabrication metal |
| we do custom welding, machining and metal fabricat | 331410 | ✗ | ✓ | 14% | custom welding machining, custom welding, welding machining, welding and metal, metal fabrication, defense customers metal |

