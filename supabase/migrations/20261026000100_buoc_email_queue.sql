-- Durable, idempotent BUOC email queue.
-- Run once in Supabase SQL Editor. Service-role-only table; never expose queue data publicly.
create extension if not exists pgcrypto;

create table if not exists public.buoc_email_jobs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  event_type text not null,
  reference_code text,
  recipient text not null,
  subject text not null,
  html text not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','dead')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  resend_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists buoc_email_jobs_due_idx
  on public.buoc_email_jobs(status, next_attempt_at, created_at)
  where status in ('pending','processing');
alter table public.buoc_email_jobs enable row level security;
revoke all on public.buoc_email_jobs from anon, authenticated;
grant select, insert, update on public.buoc_email_jobs to service_role;

create or replace function public.buoc_claim_email_jobs(p_limit integer default 10)
returns setof public.buoc_email_jobs
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return query
  with candidates as (
    select id from public.buoc_email_jobs
    where (status = 'pending' and next_attempt_at <= now())
       or (status = 'processing' and locked_at < now() - interval '10 minutes')
    order by next_attempt_at, created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit,10), 25))
  )
  update public.buoc_email_jobs j
  set status='processing', locked_at=now(), attempts=j.attempts+1, updated_at=now()
  from candidates c where j.id=c.id
  returning j.*;
end;
$$;
revoke all on function public.buoc_claim_email_jobs(integer) from public, anon, authenticated;
grant execute on function public.buoc_claim_email_jobs(integer) to service_role;

create or replace function public.buoc_email_queue_stats()
returns jsonb language sql security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'pending', count(*) filter (where status='pending'),
    'processing', count(*) filter (where status='processing'),
    'sent_last_24h', count(*) filter (where status='sent' and sent_at > now()-interval '24 hours'),
    'dead', count(*) filter (where status='dead')
  ) from public.buoc_email_jobs;
$$;
revoke all on function public.buoc_email_queue_stats() from public, anon, authenticated;
grant execute on function public.buoc_email_queue_stats() to service_role;
comment on table public.buoc_email_jobs is 'Private durable notification outbox. Access only through the service role and buoc-email-notifications Edge Function.';
