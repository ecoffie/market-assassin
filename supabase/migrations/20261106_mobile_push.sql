-- Mindy iOS/Android app push notifications.
-- Hand-run (see CLAUDE.md: migrations are applied with `npm run migrate -- --only <file> --go`).

create table if not exists mobile_push_tokens (
  id            bigserial primary key,
  user_email    text not null,
  token         text not null unique,
  platform      text not null check (platform in ('ios', 'android')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  disabled_at   timestamptz,
  disabled_reason text
);
create index if not exists mobile_push_tokens_email_idx
  on mobile_push_tokens (user_email) where disabled_at is null;

-- One push per user per day per type. The row is the CLAIM (inserted before sending),
-- so a re-run of the cron can never double-notify.
create table if not exists mobile_push_log (
  id          bigserial primary key,
  user_email  text not null,
  push_date   date not null,
  push_type   text not null,
  status      text not null default 'claimed',   -- claimed | sent | failed | no_device
  sent_count  int not null default 0,
  error       text,
  created_at  timestamptz not null default now(),
  unique (user_email, push_date, push_type)
);

alter table mobile_push_tokens enable row level security;
alter table mobile_push_log enable row level security;
