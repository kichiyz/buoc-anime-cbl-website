-- BUOC Concern Desk schema for Supabase. Run in SQL Editor as project owner.
create extension if not exists pgcrypto;

create table if not exists public.buoc_officers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  officer_name text not null,
  officer_role text not null default 'officer',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.buoc_concerns (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique default ('BUOC-' || upper(substr(encode(gen_random_bytes(8),'hex'),1,10))),
  submitter_name text not null check (char_length(submitter_name) between 2 and 120),
  submitter_email text not null check (char_length(submitter_email) <= 254),
  submitter_contact text check (submitter_contact is null or char_length(submitter_contact) <= 100),
  campus text not null default 'Not specified',
  category text not null check (category in ('Inquiry','Concern','Complaint','Suggestion','Membership','Event or activity','Other')),
  subject text not null check (char_length(subject) between 2 and 160),
  message text not null check (char_length(message) between 10 and 8000),
  attachment_path text,
  status text not null default 'new' check (status in ('new','under_review','awaiting_submitter','resolved','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.buoc_concern_replies (
  id uuid primary key default gen_random_uuid(),
  concern_id uuid not null references public.buoc_concerns(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 8000),
  author_role text not null check (author_role in ('officer','system')),
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists buoc_concerns_created_at_idx on public.buoc_concerns(created_at desc);
create index if not exists buoc_concerns_email_idx on public.buoc_concerns(lower(submitter_email));
create index if not exists buoc_replies_concern_id_idx on public.buoc_concern_replies(concern_id,created_at);

create or replace function public.buoc_is_officer()
returns boolean language sql stable security definer set search_path = public, auth
as $$ select exists(select 1 from public.buoc_officers o where o.user_id=auth.uid() and o.active=true); $$;
revoke all on function public.buoc_is_officer() from public;
grant execute on function public.buoc_is_officer() to authenticated;

alter table public.buoc_officers enable row level security;
alter table public.buoc_concerns enable row level security;
alter table public.buoc_concern_replies enable row level security;

-- Only active officers may read the allowlist or manage reports/replies.
drop policy if exists "active officers read officer list" on public.buoc_officers;
create policy "active officers read officer list" on public.buoc_officers for select to authenticated using (public.buoc_is_officer());
drop policy if exists "officers read all concerns" on public.buoc_concerns;
create policy "officers read all concerns" on public.buoc_concerns for select to authenticated using (public.buoc_is_officer());
drop policy if exists "officers update concerns" on public.buoc_concerns;
create policy "officers update concerns" on public.buoc_concerns for update to authenticated using (public.buoc_is_officer()) with check (public.buoc_is_officer());
drop policy if exists "officers read replies" on public.buoc_concern_replies;
create policy "officers read replies" on public.buoc_concern_replies for select to authenticated using (public.buoc_is_officer());
drop policy if exists "officers add replies" on public.buoc_concern_replies;
create policy "officers add replies" on public.buoc_concern_replies for insert to authenticated with check (public.buoc_is_officer() and author_id=auth.uid() and author_role='officer');

-- Public submission uses a validation function; the raw table has no public INSERT policy.
create or replace function public.submit_buoc_concern(
 p_name text,p_email text,p_contact text,p_campus text,p_category text,p_subject text,p_message text,p_attachment_path text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid; v_ref text; v_email text; v_path text;
begin
 v_email := lower(trim(coalesce(p_email,'')));
 v_path := nullif(trim(coalesce(p_attachment_path,'')),'');
 if char_length(trim(coalesce(p_name,''))) not between 2 and 120 then raise exception 'Invalid name'; end if;
 if char_length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email'; end if;
 if char_length(trim(coalesce(p_subject,''))) not between 2 and 160 then raise exception 'Invalid subject'; end if;
 if char_length(trim(coalesce(p_message,''))) not between 10 and 8000 then raise exception 'Invalid message'; end if;
 if coalesce(p_category,'') not in ('Inquiry','Concern','Complaint','Suggestion','Membership','Event or activity','Other') then raise exception 'Invalid category'; end if;
 if v_path is not null and (v_path !~ '^incoming/[A-Fa-f0-9-]+\.(png|jpg|jpeg|webp|pdf|txt|doc|docx)$') then raise exception 'Invalid attachment path'; end if;
 -- Basic per-email throttle. Add edge-function CAPTCHA/IP rate limiting before public launch.
 if (select count(*) from public.buoc_concerns where lower(submitter_email)=v_email and created_at > now()-interval '10 minutes') >= 3 then raise exception 'Submission limit reached; please try again later'; end if;
 insert into public.buoc_concerns(submitter_name,submitter_email,submitter_contact,campus,category,subject,message,attachment_path)
 values(trim(p_name),v_email,nullif(trim(coalesce(p_contact,'')),''),left(coalesce(nullif(trim(p_campus),''),'Not specified'),80),p_category,trim(p_subject),trim(p_message),v_path)
 returning id,reference_code into v_id,v_ref;
 return jsonb_build_object('id',v_id,'reference_code',v_ref);
end; $$;
revoke all on function public.submit_buoc_concern(text,text,text,text,text,text,text,text) from public;
grant execute on function public.submit_buoc_concern(text,text,text,text,text,text,text,text) to anon, authenticated;

-- Submitter can retrieve only their own report after supplying both reference and matching email.
create or replace function public.lookup_buoc_concern(p_reference_code text,p_email text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_report public.buoc_concerns%rowtype; v_replies jsonb;
begin
 select * into v_report from public.buoc_concerns where reference_code=upper(trim(p_reference_code)) and lower(submitter_email)=lower(trim(p_email));
 if not found then return null; end if;
 select coalesce(jsonb_agg(jsonb_build_object('author_role',r.author_role,'body',r.body,'created_at',r.created_at) order by r.created_at),'[]'::jsonb)
 into v_replies from public.buoc_concern_replies r where r.concern_id=v_report.id;
 return jsonb_build_object('reference_code',v_report.reference_code,'subject',v_report.subject,'status',v_report.status,'updated_at',v_report.updated_at,'replies',v_replies);
end; $$;
revoke all on function public.lookup_buoc_concern(text,text) from public;
grant execute on function public.lookup_buoc_concern(text,text) to anon, authenticated;

create or replace function public.buoc_touch_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists buoc_concerns_touch_updated_at on public.buoc_concerns;
create trigger buoc_concerns_touch_updated_at before update on public.buoc_concerns for each row execute function public.buoc_touch_updated_at();

-- Private attachment bucket. Anonymous visitors may upload only; no public read/download.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('concern-attachments','concern-attachments',false,5242880,array['image/png','image/jpeg','image/webp','application/pdf','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "public can upload concern attachments" on storage.objects;
create policy "public can upload concern attachments" on storage.objects for insert to anon,authenticated with check (bucket_id='concern-attachments' and (storage.foldername(name))[1]='incoming' and owner_id is null);
drop policy if exists "officers read concern attachments" on storage.objects;
create policy "officers read concern attachments" on storage.objects for select to authenticated using (bucket_id='concern-attachments' and public.buoc_is_officer());
drop policy if exists "officers delete concern attachments" on storage.objects;
create policy "officers delete concern attachments" on storage.objects for delete to authenticated using (bucket_id='concern-attachments' and public.buoc_is_officer());


-- Durable email queue is also available as an independently rerunnable migration.
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
