create extension if not exists "pgcrypto";

create table searches (
  id          uuid primary key default gen_random_uuid(),
  url         text not null,
  params      jsonb not null,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);

create table jobs (
  id                uuid primary key default gen_random_uuid(),
  source            text not null,
  external_id       text not null,
  position          text not null,
  company_name      text not null,
  company_id        bigint,
  address_district  text,
  address_full      text,
  url               text not null,
  due_time          date,
  intro             text,
  requirements      text,
  main_tasks        text,
  preferred_points  text,
  benefits          text,
  skill_tags        jsonb not null default '[]'::jsonb,
  raw               jsonb,
  first_seen_at     timestamptz not null default now(),
  detail_status     text not null default 'pending',
  detail_attempts   int  not null default 0,
  detail_error      text,
  bookmarked        boolean not null default false,
  hidden            boolean not null default false,
  unique (source, external_id)
);

create index jobs_detail_pending_idx
  on jobs (detail_status, detail_attempts)
  where detail_status = 'pending';

create table search_hits (
  search_id uuid not null references searches(id) on delete cascade,
  job_id    uuid not null references jobs(id) on delete cascade,
  primary key (search_id, job_id)
);

create table profile (
  id             int primary key default 1 check (id = 1),
  resume_text    text not null default '',
  rubric_version text not null default 'v1',
  notify_email   text not null default '',
  notify_rule    jsonb not null default '{"topN":3,"minScore":60}'::jsonb,
  updated_at     timestamptz not null default now()
);
insert into profile (id) values (1) on conflict do nothing;

create table scores (
  job_id         uuid primary key references jobs(id) on delete cascade,
  total          int not null default 0,
  breakdown      jsonb not null default '{}'::jsonb,
  reasoning      text not null default '',
  scorer         text not null default 'routine',
  rubric_version text not null default 'v1',
  status         text not null default 'ok',
  attempts       int  not null default 0,
  error          text,
  scored_at      timestamptz not null default now(),
  notified_at    timestamptz
);

create index scores_notify_idx on scores (total desc) where notified_at is null;

create table notifications (
  id         uuid primary key default gen_random_uuid(),
  status     text not null default 'pending',
  job_ids    jsonb not null,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  error      text
);

create table runs (
  id         uuid primary key default gen_random_uuid(),
  trigger    text not null,
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);

create table node_runs (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references runs(id) on delete cascade,
  node        text not null,
  item_id     text not null,
  status      text not null,
  duration_ms int not null,
  error       text,
  created_at  timestamptz not null default now()
);
