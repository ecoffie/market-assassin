/**
 * Adapt an `agency_forecasts` row into the shape the saved-search alert email
 * already renders (`AlertOpp`, built for `sam_opportunities`).
 *
 * WHY AN ADAPTER AND NOT A SECOND EMAIL: the Target-card template is the same
 * decision surface either way — what is it, who is buying, what set-aside, when.
 * Forking it would mean two templates drifting apart, and the forecast card
 * would inevitably fall behind the one people actually see. Mapping the fields
 * once keeps a single template honest.
 *
 * THE FIELD THAT NEEDS A JUDGEMENT CALL: a forecast has no response deadline —
 * it is 6-18 months upstream of a solicitation. Its analogue is the ANTICIPATED
 * SOLICITATION DATE, because that is the date a capture manager actually plans
 * against. Mapping it into `response_deadline` makes the card's "due" line read
 * correctly, but it also means the template's URGENCY styling (red under 7 days)
 * can fire on a forecast. That is deliberate: a solicitation expected inside a
 * week IS urgent. What we do NOT do is invent a date when the agency published
 * none — `anticipated_award_date`/`solicitation_date` are frequently null and
 * the card then shows "—", which is the honest answer.
 *
 * Everything here is a rename or a null. Nothing is derived, inferred, or
 * defaulted to a plausible value.
 */

export interface ForecastRowForAlert {
  external_id?: string | null;
  title?: string | null;
  source_agency?: string | null;
  department?: string | null;
  contracting_office?: string | null;
  naics_code?: string | null;
  set_aside_type?: string | null;
  fiscal_year?: string | null;
  anticipated_quarter?: string | null;
  anticipated_award_date?: string | null;
  solicitation_date?: string | null;
  estimated_value_max?: number | null;
  estimated_value_range?: string | null;
  pop_city?: string | null;
  pop_state?: string | null;
  last_synced_at?: string | null;
}

/** The map URL a forecast card should link to — the horizon that shows it.
 *  ?mode=, not ?horizon=: the map has never read `horizon`, so every forecast row in a live
 *  alert email landed on the unfiltered national map. `mode=forecast` is routed through
 *  toggleHorizon at boot (which owns chip sync + the "never turn the last one off" guard). */
const FORECAST_URL = '/opportunity-map?mode=forecast';

/**
 * "FY2026" + "Q3" → "Q3 FY2026"; either alone → that alone; neither → ''.
 * This is the timing a forecast actually carries, and it goes in the slot the
 * SAM card uses for notice type — the "what kind of thing is this" line.
 */
export function forecastTimingLabel(r: ForecastRowForAlert): string {
  const fy = (r.fiscal_year || '').trim();
  const q = (r.anticipated_quarter || '').trim();
  if (fy && q) return `${q} ${fy}`;
  return fy || q || '';
}

export function toAlertRow(r: ForecastRowForAlert, mindyUrl: string): Record<string, unknown> {
  const timing = forecastTimingLabel(r);
  return {
    // The saved-search dedupe keys on notice_id; a forecast's stable id is its
    // external_id. Same contract, different column name.
    notice_id: r.external_id ?? null,
    title: r.title ?? null,
    department: r.department || r.source_agency || null,
    // The office is the actionable buyer for a forecast — surface it where the
    // SAM card shows the solicitation number.
    solicitation_number: r.contracting_office ?? null,
    naics_code: r.naics_code ?? null,
    // agency_forecasts stores a human set-aside label ("SDVOSB"), not a SAM
    // code. The template maps codes via SET_ASIDE_CHIP and falls through to the
    // raw value, so passing the label reads correctly either way.
    set_aside_code: r.set_aside_type ?? null,
    // Label the card as a forecast, with its timing when the agency gave one.
    notice_type: timing ? `Forecast · ${timing}` : 'Forecast',
    // A forecast is not "posted" — the closest true fact is when we last saw it
    // in the source file.
    posted_date: r.last_synced_at ?? null,
    // See the header note: the anticipated solicitation date is the planning
    // date. NULL stays NULL — the card shows "—" rather than a guess.
    response_deadline: r.solicitation_date || r.anticipated_award_date || null,
    ui_link: `${mindyUrl}${FORECAST_URL}`,
    pop_city: r.pop_city ?? null,
    pop_state: r.pop_state ?? null,
  };
}
