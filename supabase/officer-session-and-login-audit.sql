-- BUOC Officer Desk: one active browser/device session per officer + President-only login audit.
-- Apply this file in Supabase SQL Editor before deploying the matching officer.html update.
-- Logs successful sign-ins and duplicate-session denials. Password failures rejected by Supabase Auth
-- before an authenticated user exists are intentionally not recorded by this migration.

create table if not exists public.buoc_officer_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_key text not null,
  last_seen timestamptz not null default now()
);

create table if not exists public.buoc_login_audit (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  officer_name text not null,
  officer_role text not null,
  event_type text not null check (event_type in ('login_success','duplicate_session_denied','session_released')),
  occurred_at timestamptz not null default now(),
  user_agent text
);

alter table public.buoc_officer_sessions enable row level security;
alter table public.buoc_login_audit enable row level security;

drop policy if exists "President can read login audit" on public.buoc_login_audit;
create policy "President can read login audit"
on public.buoc_login_audit for select to authenticated
using (
  exists (
    select 1 from public.buoc_officers o
    where o.user_id = auth.uid()
      and o.active = true
      and lower(o.officer_role) like '%president%'
  )
);

revoke all on public.buoc_officer_sessions from anon, authenticated;
revoke all on public.buoc_login_audit from anon, authenticated;
grant select on public.buoc_login_audit to authenticated;

create or replace function public.buoc_claim_officer_session(p_session_key text, p_user_agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_officer public.buoc_officers%rowtype;
  v_current public.buoc_officer_sessions%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  if p_session_key is null or length(p_session_key) < 16 or length(p_session_key) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_session_key');
  end if;

  select * into v_officer
  from public.buoc_officers
  where user_id = v_uid and active = true
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_active_officer');
  end if;

  -- Serialize simultaneous claims for the same user.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  select * into v_current from public.buoc_officer_sessions where user_id = v_uid;

  if found and v_current.session_key <> p_session_key and v_current.last_seen > now() - interval '75 seconds' then
    insert into public.buoc_login_audit(user_id,officer_name,officer_role,event_type,user_agent)
    values(v_uid,v_officer.officer_name,v_officer.officer_role,'duplicate_session_denied',left(p_user_agent,500));
    return jsonb_build_object('ok', false, 'reason', 'already_logged_in', 'last_seen', v_current.last_seen);
  end if;

  insert into public.buoc_officer_sessions(user_id,session_key,last_seen)
  values(v_uid,p_session_key,now())
  on conflict(user_id) do update set session_key=excluded.session_key,last_seen=now();

  insert into public.buoc_login_audit(user_id,officer_name,officer_role,event_type,user_agent)
  values(v_uid,v_officer.officer_name,v_officer.officer_role,'login_success',left(p_user_agent,500));
  return jsonb_build_object('ok', true, 'officer_name', v_officer.officer_name, 'officer_role', v_officer.officer_role);
end;
$$;

create or replace function public.buoc_heartbeat_officer_session(p_session_key text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then return false; end if;
  update public.buoc_officer_sessions
    set last_seen = now()
    where user_id = auth.uid() and session_key = p_session_key;
  return found;
end;
$$;

create or replace function public.buoc_release_officer_session(p_session_key text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_officer public.buoc_officers%rowtype;
begin
  if auth.uid() is null then return false; end if;
  select * into v_officer from public.buoc_officers where user_id=auth.uid() and active=true limit 1;
  delete from public.buoc_officer_sessions where user_id=auth.uid() and session_key=p_session_key;
  if found and v_officer.user_id is not null then
    insert into public.buoc_login_audit(user_id,officer_name,officer_role,event_type)
    values(auth.uid(),v_officer.officer_name,v_officer.officer_role,'session_released');
    return true;
  end if;
  return false;
end;
$$;

revoke all on function public.buoc_claim_officer_session(text,text) from public, anon;
revoke all on function public.buoc_heartbeat_officer_session(text) from public, anon;
revoke all on function public.buoc_release_officer_session(text) from public, anon;
grant execute on function public.buoc_claim_officer_session(text,text) to authenticated;
grant execute on function public.buoc_heartbeat_officer_session(text) to authenticated;
grant execute on function public.buoc_release_officer_session(text) to authenticated;
