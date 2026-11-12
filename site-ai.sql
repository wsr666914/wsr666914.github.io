create table if not exists public.site_ai_usage (
  day date not null,
  bucket text not null,
  calls integer not null,
  primary key (day, bucket)
);
alter table public.site_ai_usage enable row level security;
revoke all on public.site_ai_usage from public, anon, authenticated;

create or replace function public.site_ai_reserve(p_user uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'UTC')::date;
begin
  perform pg_catalog.pg_advisory_xact_lock(49372581);
  if exists (
    select 1 from public.site_ai_usage where day = today and
      ((bucket = 'global' and calls >= 200) or (bucket = p_user::text and calls >= 20))
  ) then return false; end if;
  insert into public.site_ai_usage as usage (day, bucket, calls)
  values (today, 'global', 1), (today, p_user::text, 1)
  on conflict (day, bucket) do update set calls = usage.calls + 1;
  return true;
end;
$$;
revoke all on function public.site_ai_reserve(uuid) from public, anon, authenticated;
grant execute on function public.site_ai_reserve(uuid) to service_role;
