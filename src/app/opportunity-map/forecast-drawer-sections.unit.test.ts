/**
 * The 8-section FORECAST listing drawer (Eric 2026-08-05, verbatim FINAL spec): "Keep the same eight-
 * section reading order across opportunity types, but frame every section for planned work. Do not
 * show empty solicitation, attachment, compliance, or proposal states. Replace 'Win This Contract'
 * with 'Prepare to Win,' and replace Bid / No-Bid with Track / Research / Start Capture logic.
 * Forecasts are an early-capture product, not incomplete solicitations."
 *
 * This locks the load-bearing facts that make the forecast drawer that product, not a broken open-opp:
 *   1. The EIGHT sections exist in order, each with the anchor buildTabs() resolves for the forecast
 *      drawer (overview → ai → fcdesc → fcmkt → fcpoc → openbids → fcwin → actions).
 *   2. "Should I pursue this?" uses TRACK / RESEARCH / START CAPTURE — never Bid/No-Bid on a forecast
 *      (there is no bid yet).
 *   3. Section 7 is "Prepare to win" — NOT "Win This Contract" — and it does NOT open the proposal
 *      workspace / draft / compliance (nothing to draft against yet).
 *   4. The forecast Actions bar is Track-led (no "Generate proposal", no "View on SAM" — a forecast
 *      has no SAM notice and nothing to draft).
 *   5. CONTACTS: the agency roster loads into the Buyer section (loadForecastRoster → loadRoster into
 *      #fcBuyerBox), so the POC + roster live together.
 *   6. NO empty solicitation/attachment/compliance state: the async loader (loadForecastDetail) fills
 *      labelled section boxes and fails soft to honest copy, never a dead solicitation shell.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

// The synchronous skeleton forecastRender returns — from `return overview` to the next `function`.
const frStart = route.indexOf('function forecastRender(o){');
const frBody = route.slice(frStart, route.indexOf('\n  function ', frStart + 40));

describe('Forecast drawer — the eight sections, forecast-framed', () => {
  it('forecastRender emits all 8 sections in reading order', () => {
    expect(frStart, 'forecastRender must exist').toBeGreaterThan(-1);
    // 1 overview, 2 pursue (fcPursueSec), 3 opportunity (#fcOppBox), 4 market (#fcMktBox),
    // 5 buyer (#fcBuyerBox), 6 related (#xsellOpen), 7 prepare (fcPrepareSec), 8 actions (fcActions)
    const order = [
      'id="osec-overview"',
      'fcPursueSec(o)',
      "id=\"fcOppBox\"",
      "id=\"fcMktBox\"",
      "id=\"fcBuyerBox\"",
      "id=\"xsellOpen\"",
      'fcPrepareSec(o)',
      'fcActions(o)',
    ];
    let last = -1;
    for (const tok of order) {
      const at = frBody.indexOf(tok);
      expect(at, `${tok} present in forecastRender`).toBeGreaterThan(-1);
      expect(at, `${tok} comes after the previous section`).toBeGreaterThan(last);
      last = at;
    }
  });

  it('Section 2 = Track / Research / Start capture — NEVER Bid / No-Bid on a forecast', () => {
    const s = route.indexOf('function fcPursueSec(o){');
    expect(s, 'fcPursueSec must exist').toBeGreaterThan(-1);
    const body = route.slice(s, route.indexOf('\n  function ', s + 20));
    expect(body).toContain('Track it');
    expect(body).toContain('Research the market');
    expect(body).toContain('Start capture');
    // A forecast is a capture decision, not a bid decision — no Bid/No-Bid button here.
    expect(body).not.toMatch(/Bid\s*\/\s*No-Bid/);
    expect(body).not.toContain('runAI(');
    // It IS the "Should I pursue this?" section (same heading as the open drawer)
    expect(body).toContain('Should I pursue this?');
    expect(body).toContain("'ai'"); // anchor osec-ai, so the Pursue tab resolves
  });

  it('Section 7 = "Prepare to win" — renamed from "Win This Contract", NO proposal/compliance draft', () => {
    const s = route.indexOf('function fcPrepareSec(o){');
    expect(s, 'fcPrepareSec must exist').toBeGreaterThan(-1);
    const body = route.slice(s, route.indexOf('\n  function ', s + 20));
    expect(body).toContain('Prepare to win');
    expect(body).toContain("'fcwin'"); // its anchor
    // early-capture, NOT the proposal workspace: no draft/compliance/generate-proposal here
    expect(body).not.toContain('panel=proposals');
    expect(body).not.toContain('Generate proposal');
    expect(body).not.toMatch(/compliance/i);
    // it bridges to Track + market research (the real early-capture moves)
    expect(body).toContain('Track this buy');
    expect(body).toContain('panel=research');
  });

  it('Section 8 = forecast Actions — Track-led, no "Generate proposal" / no "View on SAM"', () => {
    const s = route.indexOf('function fcActions(o){');
    expect(s, 'fcActions must exist').toBeGreaterThan(-1);
    const body = route.slice(s, route.indexOf('\n  function ', s + 20));
    expect(body).toContain('id="osec-actions"'); // the sticky deep-link anchor
    expect(body).toContain('Track this buy'); // primary early-capture action
    expect(body).not.toContain('Generate proposal');
    expect(body).not.toContain('View on SAM');
  });

  it('CONTACTS: the agency roster loads into the Buyer section (#fcBuyerBox), POC + roster together', () => {
    // loadForecastRoster reuses the open drawer's loadRoster, pointed at the forecast Buyer box.
    expect(route).toContain('function loadForecastRoster(agency)');
    expect(route).toMatch(/loadRoster\(agency,'fcBuyerBox'\)/);
    // and loadForecastDetail calls it in both the success and fail paths (Contacts always try)
    const ld = route.indexOf('function loadForecastDetail(o){');
    const ldBody = route.slice(ld, route.indexOf('\n  function loadForecastRoster', ld));
    expect((ldBody.match(/loadForecastRoster\(agency\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('NO empty solicitation/attachment/compliance shells — sections omit or fail soft to honest copy', () => {
    const ld = route.indexOf('function loadForecastDetail(o){');
    const ldBody = route.slice(ld, route.indexOf('\n  function loadForecastRoster', ld));
    // fills the 3 async section boxes by id (not the old single fcDetailBox dump)
    expect(ldBody).toContain("getElementById('fcOppBox')");
    expect(ldBody).toContain("getElementById('fcMktBox')");
    expect(ldBody).toContain("getElementById('fcBuyerBox')");
    // Market section is OMITTED when neither value nor incumbent is real (no empty market shell)
    expect(ldBody).toMatch(/mktBox\.innerHTML=''/);
    // a failed fetch degrades to an honest Opportunity message, never a dead spinner / solicitation shell
    expect(ldBody).toContain('function fail()');
    expect(ldBody).toContain('available for this planned buy right now'); // the honest fail-soft copy
  });
});
