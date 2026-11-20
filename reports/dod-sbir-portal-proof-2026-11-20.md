# DoD SBIR/STTR source proof — 2026-11-20

The false-green correction on this branch stays. `heldCount` returns null when the count read fails. `decideDodSbirExecuteOutcome` treats that as unmeasured. An api-down run is HTTP 503. `classifyDodSbirHealth` maps a 502/503 or an error run to UNREACHABLE, and an unmeasured count to UNKNOWN. `20261118_park_false_green_freshness.sql` is not applied. `sync-dod-sbir` stays enabled.

## What is reachable

| upstream | result from this environment |
|---|---|
| `https://api.www.sbir.gov/public/api/solicitations?agency=DOD&open=1` | HTTP 403 |
| `https://api.www.sbir.gov/public/api/solicitations?rows=1` | HTTP 403 |
| `https://www.defensesbirsttr.mil/` | HTTP 403 |
| `https://www.dodsbirsttr.mil/topics-app/` | HTTP 200, the public topics app |
| `GET https://www.dodsbirsttr.mil/topics/api/public/topics/search` with `topicReleaseStatus` `[591, 592]` | HTTP 200 |

Those two status ids are the topics app's default open selection (`topicWrapperDefaultSelections.topicStatus`). The unfiltered list is 33,044 topics, almost all closed. The open selection is the authoritative current list.

`scripts/prove-dod-portal.mts` (read-only, no database write) returned `complete: true`, `reportedTotal: 110`, `rows: 110` over 3 pages: **24 open**, **86 pre-release**.

Sample row the collector would upsert on `topic_number`:

- `DAF27TZ01-DV001` — USAF STTR, status `open`, open `2026-10-28`, close `2026-11-25`, solicitation `27.TZ`
- description is null (the search payload has none; it is not copied from the preface PDF)
- url `https://www.dodsbirsttr.mil/topics/api/public/topics/06da7833a5af4981b93c4cfe7dfc0362_86702/details` (HTTP 200)

`sync-dod-sbir` execute upserts that list on `(topic_number)` when the read is complete. If the DSIP list fails, the cron still probes sbir.gov and reports HTTP 503 rather than a green empty run. No rows were written from this environment.
