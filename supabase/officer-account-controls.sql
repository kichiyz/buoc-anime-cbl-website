-- BUOC Officer Portal account suspension controls.
-- Run in Supabase SQL Editor. This adds temporary suspension metadata and a President-only RPC.
alter table public.buoc_officers add column if not exists suspended_until timestamptz;
alter table public.buoc_officers add column if not exists suspension_reason text;

create or replace function public.buoc_set_officer_suspension(
  p_target_user_id uuid,
  p_suspended_until timestamptz,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor public.buoc_officers%rowtype;
  v_target public.buoc_officers%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  select * into v_actor from public.buoc_officers
    where user_id = auth.uid() and active = true
      and lower(officer_role) like '%president%' limit 1;
  if not found then raise exception 'President authorization required'; end if;

  select * into v_target from public.buoc_officers
    where user_id = p_target_user_id limit 1;
  if not found then raise exception 'Target officer account not found'; end if;
  if p_target_user_id = auth.uid() then raise exception 'The President cannot suspend their own account'; end if;
  if p_suspended_until is not null and p_suspended_until <= now() then
    raise exception 'Suspension end time must be in the future';
  end if;
  if p_suspended_until is not null and nullif(trim(p_reason),'') is null then
    raise exception 'A documented reason is required';
  end if;

  update public.buoc_officers set
    suspended_until = p_suspended_until,
    suspension_reason = case when p_suspended_until is null then null else left(trim(p_reason),1000) end
  where user_id = p_target_user_id;
  return jsonb_build_object('ok',true,'message',
    case when p_suspended_until is null then 'Temporary suspension lifted.'
    else 'Temporary suspension applied until ' || p_suspended_until::text end);
end;
$$;
revoke all on function public.buoc_set_officer_suspension(uuid,timestamptz,text) from public, anon;
grant execute on function public.buoc_set_officer_suspension(uuid,timestamptz,text) to authenticated;

-- Do not expose suspension metadata to anonymous users; the function itself enforces President authorization.
