-- Cocotte : registre des fermes, classements et visites.
-- À coller tel quel dans Supabase > SQL Editor > Run (on peut le relancer sans risque).
--
-- Sécurité : la table n'est lisible par personne directement. Le jeu passe uniquement par les
-- fonctions ci-dessous, qui ne renvoient jamais le code secret. Pas besoin de connexion Supabase :
-- le nom de la ferme + un petit code secret identifient le joueur.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.farms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  secret_hash text not null,
  level int not null default 1,
  xp bigint not null default 0,
  hens int not null default 0,
  laying_rate real not null default 0,
  wellbeing real not null default 0,
  money bigint not null default 0,
  game_day int not null default 1,
  save text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint farm_name_len check (char_length(name) between 3 and 24)
);

-- deux fermes ne peuvent pas avoir le même nom (majuscules ignorées)
create unique index if not exists farms_name_key on public.farms (lower(name));
create index if not exists farms_level_idx on public.farms (level desc, xp desc);

alter table public.farms enable row level security;
revoke all on public.farms from anon, authenticated;

-- Le nom est-il libre ?
create or replace function public.farm_available(p_name text)
returns boolean
language sql security definer set search_path = public, extensions
as $$
  select not exists (select 1 from public.farms where lower(name) = lower(trim(p_name)));
$$;

-- Réserve un nom de ferme avec son code secret. Renvoie 'ok', 'taken' ou 'invalid'.
create or replace function public.claim_farm(p_name text, p_secret text)
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
  n text := trim(p_name);
begin
  if n !~ '^[A-Za-zÀ-ÿ0-9 _''’.-]{3,24}$' or coalesce(length(p_secret), 0) < 4 or length(p_secret) > 64 then
    return 'invalid';
  end if;
  insert into public.farms (name, secret_hash) values (n, extensions.crypt(p_secret, extensions.gen_salt('bf')));
  return 'ok';
exception when unique_violation then
  return 'taken';
end;
$$;

-- Envoie l'état de la ferme (classement + sauvegarde à visiter).
-- Renvoie 'ok', 'denied' (mauvais code), 'unknown', 'wait' (trop rapproché) ou 'invalid'.
create or replace function public.push_farm(
  p_name text, p_secret text,
  p_level int, p_xp bigint, p_hens int, p_laying real, p_wellbeing real,
  p_money bigint, p_day int, p_save text
)
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
  f public.farms;
begin
  select * into f from public.farms where lower(name) = lower(trim(p_name));
  if not found then return 'unknown'; end if;
  if extensions.crypt(p_secret, f.secret_hash) <> f.secret_hash then return 'denied'; end if;
  if now() - f.updated_at < interval '20 seconds' then return 'wait'; end if;
  if p_level < 1 or p_level > 500 or p_xp < 0 or p_hens < 0 or p_hens > 20000
     or p_laying < 0 or p_laying > 1.5 or p_wellbeing < 0 or p_wellbeing > 100
     or p_money < -1000000000 or p_money > 1000000000000 or p_day < 1
     or p_save is null or length(p_save) > 6000000 then
    return 'invalid';
  end if;
  update public.farms set
    level = p_level, xp = p_xp, hens = p_hens, laying_rate = p_laying, wellbeing = p_wellbeing,
    money = p_money, game_day = p_day, save = p_save, updated_at = now()
  where id = f.id;
  return 'ok';
end;
$$;

-- Retrouve sa ferme sur un autre appareil : renvoie la sauvegarde si le code est bon.
create or replace function public.restore_farm(p_name text, p_secret text)
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
  f public.farms;
begin
  select * into f from public.farms where lower(name) = lower(trim(p_name));
  if not found then raise exception 'unknown'; end if;
  if extensions.crypt(p_secret, f.secret_hash) <> f.secret_hash then raise exception 'denied'; end if;
  return f.save;
end;
$$;

-- Classement : 'level' (par défaut), 'laying' (taux de ponte) ou 'wellbeing' (bien-être).
-- Les classements de taux ne comptent que les fermes d'au moins 10 volailles.
create or replace function public.get_board(p_sort text default 'level', p_limit int default 50)
returns table (name text, level int, xp bigint, hens int, laying_rate real, wellbeing real, game_day int, updated_at timestamptz)
language sql security definer set search_path = public, extensions
as $$
  select f.name, f.level, f.xp, f.hens, f.laying_rate, f.wellbeing, f.game_day, f.updated_at
  from public.farms f
  where f.save is not null and (p_sort = 'level' or f.hens >= 10)
  order by
    case when p_sort = 'laying' then f.laying_rate end desc nulls last,
    case when p_sort = 'wellbeing' then f.wellbeing end desc nulls last,
    f.level desc, f.xp desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- Visite : la sauvegarde publique d'une ferme.
create or replace function public.get_farm_save(p_name text)
returns table (name text, level int, hens int, save text)
language sql security definer set search_path = public, extensions
as $$
  select f.name, f.level, f.hens, f.save from public.farms f
  where lower(f.name) = lower(trim(p_name)) and f.save is not null;
$$;

revoke all on function public.farm_available(text), public.claim_farm(text, text),
  public.push_farm(text, text, int, bigint, int, real, real, bigint, int, text),
  public.restore_farm(text, text), public.get_board(text, int), public.get_farm_save(text) from public;
grant execute on function public.farm_available(text), public.claim_farm(text, text),
  public.push_farm(text, text, int, bigint, int, real, real, bigint, int, text),
  public.restore_farm(text, text), public.get_board(text, int), public.get_farm_save(text) to anon, authenticated;
