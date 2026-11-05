-- Cocotte : le coucou entre fermes.
-- À coller tel quel dans Supabase > SQL Editor > Run, après schema.sql (on peut le relancer sans risque).
--
-- Sécurité : comme pour les fermes, la table n'est lisible par personne directement. L'expéditeur
-- prouve qui il est avec son code secret : personne ne peut passer le coucou au nom d'une autre ferme.

create table if not exists public.greetings (
  id bigint generated always as identity primary key,
  to_farm uuid not null references public.farms (id) on delete cascade,
  from_farm uuid not null references public.farms (id) on delete cascade,
  seen boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists greetings_inbox_idx on public.greetings (to_farm) where not seen;
create index if not exists greetings_pair_idx on public.greetings (from_farm, to_farm, created_at desc);

alter table public.greetings enable row level security;
revoke all on public.greetings from anon, authenticated;

-- Passe le coucou à une ferme : au plus une fois par heure à la même ferme, et 100 par jour au total.
-- Renvoie 'ok', 'wait' (déjà passé), 'self', 'denied' (mauvais code) ou 'unknown'.
create or replace function public.send_greeting(p_from text, p_secret text, p_to text)
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
  me uuid;
  my_hash text;
  them uuid;
begin
  select f.id, f.secret_hash into me, my_hash from public.farms f where lower(f.name) = lower(trim(p_from));
  if not found then return 'unknown'; end if;
  if extensions.crypt(p_secret, my_hash) <> my_hash then return 'denied'; end if;
  select f.id into them from public.farms f where lower(f.name) = lower(trim(p_to));
  if not found then return 'unknown'; end if;
  if them = me then return 'self'; end if;
  if exists (
    select 1 from public.greetings g
    where g.from_farm = me and g.to_farm = them and g.created_at > now() - interval '1 hour'
  ) then
    return 'wait';
  end if;
  if (select count(*) from public.greetings g where g.from_farm = me and g.created_at > now() - interval '1 day') >= 100 then
    return 'wait';
  end if;
  -- la table ne grossit pas : les vieux coucous s'effacent
  delete from public.greetings g where g.created_at < now() - interval '30 days';
  insert into public.greetings (to_farm, from_farm) values (them, me);
  return 'ok';
end;
$$;

-- Les coucous reçus et pas encore vus : ils sont marqués comme vus en les lisant.
create or replace function public.read_greetings(p_name text, p_secret text)
returns table (from_name text, sent_at timestamptz)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  me uuid;
  my_hash text;
begin
  select f.id, f.secret_hash into me, my_hash from public.farms f where lower(f.name) = lower(trim(p_name));
  if not found or extensions.crypt(p_secret, my_hash) <> my_hash then
    raise exception 'denied';
  end if;
  return query
    with fresh as (
      update public.greetings g set seen = true
      where g.to_farm = me and not g.seen
      returning g.from_farm, g.created_at
    )
    select sender.name, fresh.created_at
    from fresh join public.farms sender on sender.id = fresh.from_farm
    order by fresh.created_at desc
    limit 50;
end;
$$;

revoke all on function public.send_greeting(text, text, text), public.read_greetings(text, text) from public;
grant execute on function public.send_greeting(text, text, text), public.read_greetings(text, text) to anon, authenticated;
