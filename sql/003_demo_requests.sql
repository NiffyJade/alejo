-- Demo requests from the Alejo marketing site.
-- Written only by the `demo-request` edge function (service role); RLS is on with no policies,
-- so the public anon key can read and write nothing here.

create table if not exists demo_requests (
  id          uuid primary key default gen_random_uuid(),
  hotel       text not null default '',
  email       text not null,
  rooms       text not null default '',
  source      text not null default 'website',
  ip_hash     text,                          -- sha-256 of the caller's IP, used only to rate-limit
  status      text not null default 'new'
              check (status in ('new','contacted','demo_booked','pilot','not_a_fit')),
  notes       text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists demo_requests_created_idx on demo_requests (created_at desc);
create index if not exists demo_requests_ip_idx on demo_requests (ip_hash, created_at desc);

alter table demo_requests enable row level security;
