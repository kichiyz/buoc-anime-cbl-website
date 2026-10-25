-- BUOC Officer Portal: safely delete a closed concern and its replies.
-- Run this file in Supabase SQL Editor before using "Delete closed concern".
-- Only an authenticated, active BUOC officer can call this function.
-- The function re-checks status in the database and removes replies first to avoid FK blockers.

create or replace function public.buoc_delete_closed_concern(p_concern_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted_id uuid;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.buoc_officers o
    where o.user_id = v_uid and o.active = true
  ) then
    raise exception 'Active BUOC officer authorization required';
  end if;

  -- Lock the row and verify that it is still closed before deleting anything.
  select c.id into v_deleted_id
  from public.buoc_concerns c
  where c.id = p_concern_id and c.status = 'closed'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Concern not found or it is no longer closed. Refresh reports and try again.');
  end if;

  delete from public.buoc_concern_replies where concern_id = v_deleted_id;
  delete from public.buoc_concerns where id = v_deleted_id and status = 'closed';

  if not found then
    raise exception 'Concern could not be deleted; it may no longer be closed';
  end if;

  return jsonb_build_object('ok', true, 'message', 'Closed concern and its replies deleted.');
end;
$$;

revoke all on function public.buoc_delete_closed_concern(uuid) from public, anon;
grant execute on function public.buoc_delete_closed_concern(uuid) to authenticated;
