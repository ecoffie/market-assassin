# Events prune decision pack (REPORT-ONLY) — 2026-11-18

**Status:** decision pack only. `SAM_EVENTS_PRUNE` is unset in production. Do **not** set `=apply` without Eric + Agent 5 authorization.

## Measured production facts

| Fact | Value |
|---|---|
| Serving SHA (`maps-account-build`) | `c6c9c0864` (includes #2147) |
| `extract-sam-events` last run | 2026-11-18 07:00:27Z · HTTP 200 · 5477ms · cron_jobs last_status=success |
| `sam_events` total | 8,266 (was 8,163 on 11-17 probe) |
| Upcoming (`event_date >= today`) | 1,105 |
| Undated | 161 |
| Rows stamped `extracted_at` on 11-18 | **103** (only planned upserts, not every listed row) |
| `cron_logs` total rows | **0** |
| `cron_logs` `extract-sam-events:prune-report` | **0** (durable report never recorded) |
| `SAM_EVENTS_PRUNE` in Vercel prod | unset |

## Live prune proposal (computed read-only 2026-11-18T18:58:41.893Z)

| Counter | Value |
|---|---:|
| Listed rows re-read set | 1167 |
| Source notices found | 1167 |
| Missing source notices | 0 |
| Active candidates loaded | 7911 (complete=true) |
| Planned attendable events | 3405 |
| wouldRetire (pre-cap) | 53 |
| **Proposed for delete (capped)** | **53** |
| Guard skipped | (none — proposals within cap) |

Cap: min(100, floor(reread × 0.25)).

### Exact proposed record ids

- `095bee33-b08f-4c52-829d-c88e2d094d9d` · notice `0436f905830d429989bd424be88648f5` · stored_type=rfi · stored_date=null · reason=no_event_on_reread
- `4e08c287-fb5c-47b6-a008-3a49a1421e8b` · notice `1404e4db29c0464988ab5aeff09efcb8` · stored_type=rfi · stored_date=2029-01-09 · reason=no_event_on_reread
- `4add0447-240a-4cb1-9ed8-ddef6bf6b216` · notice `1c1e4e7584a24119bf2a2c33411e88e3` · stored_type=industry_day · stored_date=null · reason=no_event_on_reread
- `5042930f-938b-4de7-810a-178470a4d716` · notice `215cae344957439d89ad2704c352ae85` · stored_type=rfi · stored_date=2027-08-10 · reason=no_event_on_reread
- `bbf68cbb-5c2f-43cb-abf8-1ddeb00a1740` · notice `23d0f9ec368a423488ecedeabf313104` · stored_type=rfi · stored_date=2029-01-09 · reason=no_event_on_reread
- `feba4062-6dbf-4fe9-8463-cbbc8502a557` · notice `2e43ee51ca86480bae66369b91918437` · stored_type=rfi · stored_date=2029-01-09 · reason=no_event_on_reread
- `73f0af7e-ac9e-4c88-825f-f693398ba39b` · notice `377f1c3467ca4f5586ee4fc5819b552c` · stored_type=industry_day · stored_date=null · reason=no_event_on_reread
- `6b8f8c81-ccea-4f9f-b162-51011de1a30e` · notice `3e89ac100b284b6b907f826ea904a4cc` · stored_type=industry_day · stored_date=2027-05-16 · reason=no_event_on_reread
- `7c7a3324-925f-4e02-a1f2-d12b1f96e131` · notice `449d4ab6fe8d48619e3b3e4940bddec2` · stored_type=rfi · stored_date=2027-10-01 · reason=no_event_on_reread
- `814c2a3f-78f5-4b8b-bf91-cd235a5d43b7` · notice `57951c00700043a69501dbec17d12a5b` · stored_type=industry_day · stored_date=null · reason=no_event_on_reread
- `5793f1ca-fd46-4f7d-b36a-5e9c03d92243` · notice `59b98c2e547f4c52afb8f07d167b4008` · stored_type=rfi · stored_date=2029-01-09 · reason=no_event_on_reread
- `ef8f188a-f42d-4331-a6cf-e92e1fa8f8d1` · notice `5afcf406ed2c4ad7b355bbe0f29bcca3` · stored_type=rfi · stored_date=2028-07-03 · reason=no_event_on_reread
- `ae3d2908-80f7-421a-a8e9-f0076db4e1d1` · notice `644ab0dac18146bb8668970b7e0257af` · stored_type=industry_day · stored_date=null · reason=no_event_on_reread
- `4aa8e17a-8957-443b-b7a3-7898651cb907` · notice `6785c01dbc8f49e6acf889415bf6e062` · stored_type=rfi · stored_date=null · reason=no_event_on_reread
- `edaf27de-7467-4fbb-aada-fe0b38606067` · notice `68190d90f8fa4fef89770c7754b85504` · stored_type=industry_day · stored_date=2026-11-30 · reason=no_event_on_reread
- `7add773d-2668-442a-8965-a5d1079d6620` · notice `6e41a85d722a4ad08ab0bd4ff857349d` · stored_type=industry_day · stored_date=2027-01-01 · reason=no_event_on_reread
- `f8dfd900-39b5-4075-ba64-1685cb678fd3` · notice `6e7c3331b4ef405b88a995229a0be936` · stored_type=industry_day · stored_date=2027-09-30 · reason=no_event_on_reread
- `22757463-66ba-4069-8096-293630ff3aaf` · notice `72540dcf3a2640e880d7e659119e5d3d` · stored_type=rfi · stored_date=2028-10-01 · reason=no_event_on_reread
- `7d9ff918-168c-4282-9577-919fe8a1be94` · notice `7d3f105a09734cbb9b3742fbaca5998f` · stored_type=rfi · stored_date=2028-10-18 · reason=no_event_on_reread
- `f0726c3f-4e67-4c73-9ee9-815d7c815650` · notice `843a7410579e49868222b53dee0c3f5a` · stored_type=rfi · stored_date=2031-10-14 · reason=no_event_on_reread
- `fa8caf66-77fe-46d6-8a3b-04eccc995813` · notice `8480f6b40fd348aab0c4ef818215c50d` · stored_type=webinar · stored_date=2026-12-10 · reason=no_event_on_reread
- `72b2d28a-44b8-41dc-9adb-a175019d56bf` · notice `86be3b0f8b914ca3af4150b23376b618` · stored_type=rfi · stored_date=2027-10-01 · reason=no_event_on_reread
- `a5e2be14-682b-4544-8de3-1bea37d180d6` · notice `87a56625bd0148f386f1a40b413f31dd` · stored_type=rfi · stored_date=2027-09-30 · reason=no_event_on_reread
- `9744e442-606f-4c5b-9d74-a8205d0c7cba` · notice `8a75a70fc12640c182b1d4e5c7ea8dee` · stored_type=rfi · stored_date=2026-12-01 · reason=no_event_on_reread
- `b057ece5-9b89-4c1b-8482-e76bf793aa25` · notice `936366f008ad4843a9528cbf3bbf0b5b` · stored_type=rfi · stored_date=2029-01-09 · reason=no_event_on_reread
- `1ed7cda3-1e3d-4ea3-b86a-5e8c9a12395e` · notice `a8706a7e4b1d4b08bb5a9daf9004f688` · stored_type=rfi · stored_date=null · reason=no_event_on_reread
- `98ee8806-9ebc-4cf4-842a-606b0ac6fb46` · notice `adf5af6cb5e54101bcc9d2ea3bcd2688` · stored_type=industry_day · stored_date=null · reason=no_event_on_reread
- `7c03211f-476c-4592-b3c4-2b9301775d7e` · notice `ae91695290414673bf9cee2ea75db592` · stored_type=rfi · stored_date=2027-02-01 · reason=no_event_on_reread
- `341ff202-dad7-444d-ae62-edda099130a8` · notice `aed6e32905054cbd9bba24d844aa8e18` · stored_type=industry_day · stored_date=null · reason=no_event_on_reread
- `f6a967fa-8c17-496b-8b59-0f9eee75a022` · notice `afe25a3c842645c3b73e874b4b5b5cf2` · stored_type=industry_day · stored_date=2026-12-23 · reason=no_event_on_reread
- `86a85ca3-c2a1-4da6-b91b-eeae65dccd00` · notice `b027c168f07e425d9f85b2b552aae761` · stored_type=industry_day · stored_date=2026-11-30 · reason=no_event_on_reread
- `055f5190-d57c-436f-93f9-d78309eeeb5f` · notice `b22fd802611348eeb379f06fb6b99a9f` · stored_type=rfi · stored_date=2027-11-30 · reason=no_event_on_reread
- `10953be2-072c-44d5-be83-78003196e72a` · notice `b392d606cee8440397c4393a3f186877` · stored_type=rfi · stored_date=2029-09-30 · reason=no_event_on_reread
- `e843baf6-3aaf-4e9a-999f-53e03a743b09` · notice `b49351c7687545ba93c3ba8a051051e9` · stored_type=rfi · stored_date=2031-05-28 · reason=no_event_on_reread
- `b1512a85-3f46-4710-afdb-6b5788443e5e` · notice `b82fcbd7a0954471bef4d03fdf691894` · stored_type=rfi · stored_date=2031-10-14 · reason=no_event_on_reread
- `507851cf-fc9f-4693-9910-527173490713` · notice `ba6562415c9941e3a39f0ef2d387b7da` · stored_type=webinar · stored_date=2026-11-19 · reason=no_event_on_reread
- `e11e1a61-e444-494f-ac35-1d243abc722f` · notice `bc27ec181ac047b3af586fc33afc74c7` · stored_type=rfi · stored_date=2028-10-01 · reason=no_event_on_reread
- `e123625b-ab12-406c-9886-c8020d66159e` · notice `bd71f84068534e5680335d83e31fc9df` · stored_type=rfi · stored_date=2029-08-26 · reason=no_event_on_reread
- `1294c0da-f939-4599-aa60-937124a94e23` · notice `bd77424c2f0840dcb1bcfcbfb74a18a6` · stored_type=industry_day · stored_date=2026-12-23 · reason=no_event_on_reread
- `8ff405b4-a0d4-448a-b889-6770714762f4` · notice `c1d244e1113845169249e8351a84b96d` · stored_type=rfi · stored_date=2026-11-30 · reason=no_event_on_reread
- `a38e933b-ac02-4101-aa79-742639964d12` · notice `c277e935161a45fb9071209ce0177010` · stored_type=industry_day · stored_date=2026-12-23 · reason=no_event_on_reread
- `6b5e2016-4932-432e-bb16-e020fd7ba910` · notice `c32527b925bd42629d26a18a592bbcc5` · stored_type=rfi · stored_date=2026-11-20 · reason=no_event_on_reread
- `2bad01a8-26ff-494a-b96e-94fbb149c0ad` · notice `c7962301870e4dd4b927e4bb329c0836` · stored_type=rfi · stored_date=2029-01-09 · reason=no_event_on_reread
- `b2cc8241-cb1d-4abd-bb39-8767537a06b0` · notice `d2d7eae711a14923a0329665c110d326` · stored_type=rfi · stored_date=2027-09-30 · reason=no_event_on_reread
- `42e0c2e6-70b9-4396-93f7-05e34e9362dd` · notice `d6da16e3b6574952a348713239290307` · stored_type=industry_day · stored_date=2026-11-30 · reason=no_event_on_reread
- `930fe41b-de58-4670-ad90-c081749729de` · notice `e3cd5e889e9f470facb0bc27a8ca5faf` · stored_type=industry_day · stored_date=2027-01-01 · reason=no_event_on_reread
- `8ccafcd3-87ad-49d5-bcb9-f2401c3e81b1` · notice `e435253f8ef24fc6bb07688b2fe852f7` · stored_type=rfi · stored_date=2030-05-29 · reason=no_event_on_reread
- `a70b768e-e57e-44e5-882f-a58472ba26fe` · notice `ea0c0850522c461ab2d73f5cb4a29780` · stored_type=industry_day · stored_date=2026-12-23 · reason=no_event_on_reread
- `9e966513-0f54-4d1f-804a-f9f1751154c3` · notice `f3e87de1f7114dca9a374cec62ad558e` · stored_type=rfi · stored_date=2029-01-09 · reason=no_event_on_reread
- `5369b807-2dff-40b2-a986-99ed863d5013` · notice `f86920ef287d44e58fb53bcaa9326c29` · stored_type=rfi · stored_date=2026-12-18 · reason=no_event_on_reread
- `76d6d6a0-6df7-4ffd-8b0a-7c53456578d5` · notice `fbb2436ff3644fe18c369b9ad258ceab` · stored_type=rfi · stored_date=2027-09-30 · reason=no_event_on_reread
- `3695497e-ab1a-474b-a5cf-10c2eaef64ce` · notice `fd8daf9429824814882419486b899606` · stored_type=rfi · stored_date=2029-01-09 · reason=no_event_on_reread
- `27bcb053-0b06-453a-9d78-8b45aceeb1e2` · notice `ff41905dc0864f419c8f60b673b6292b` · stored_type=rfi · stored_date=2026-12-01 · reason=no_event_on_reread

Machine-readable twin: `tasks/events-prune-decision-pack-2026-11-18.json`.

## Source evidence

- Classifier: `readNoticeEvent` + `planEvents` / `planRetirements` in `src/lib/events/` (same as cron).
- Only `source` null/`sam_gov` rows; title-only readings excluded; AI rows never proposed.
- Production cron response body also carries `prune.proposals` when the route runs — but that body is not persisted today because `cron_logs` inserts have never landed (table empty).

## Rollback (if a future apply is authorized)

1. Before apply: export the proposed id set from this pack / next prune-report row.
2. Apply deletes only those ids (`source` null or `sam_gov`).
3. Rollback = re-insert the exported rows. Next extract recreates a row if the notice again reads as an event.
4. Never use a table truncate. Never touch AI-discovered rows.

## Authorization gate

- Report mode (default): safe forever.
- Apply requires: set `SAM_EVENTS_PRUNE=apply` in Vercel prod + redeploy + explicit Eric/Agent-5 OK.
- Related code hardening (this branch): fail the cron (non-2xx) when prune-report insert fails so empty `cron_logs` cannot silently recur.
