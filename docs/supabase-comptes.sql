-- LeCochonnet — Comptes : administrateur principal, administrateurs, organisateurs
-- À coller UNE FOIS dans le SQL Editor de Supabase, puis Run.
-- Avant de lancer : remplacer VOTRE-EMAIL (tout en bas) par l'adresse e-mail
-- avec laquelle vous vous connectez aujourd'hui à l'appli.
-- (Ces instructions sont aussi reprises dans supabase-schema.sql.)

-- =====================================================
-- TABLE : profiles (une ligne par compte)
-- =====================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('principal', 'admin', 'organisateur')),
  identifiant text unique not null,
  nom text,
  actif boolean not null default true,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id) on delete set null
);

alter table public.profiles enable row level security;

-- Rôle du compte connecté, s'il est actif (null sinon)
create or replace function public.mon_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and actif
$$;

-- Chacun voit sa propre fiche ; les administrateurs voient toutes les fiches.
-- Personne ne crée ni ne modifie une fiche depuis le navigateur :
-- c'est le serveur du site (clé secrète) qui s'en charge, après vérification des droits.
drop policy if exists "Chacun voit son profil" on public.profiles;
create policy "Chacun voit son profil"
  on public.profiles for select
  using (id = auth.uid());

drop policy if exists "Les administrateurs voient tous les profils" on public.profiles;
create policy "Les administrateurs voient tous les profils"
  on public.profiles for select
  using (public.mon_role() in ('principal', 'admin'));

-- =====================================================
-- TOURNOIS : nouvelles règles d'accès
-- =====================================================

-- Un organisateur ne gère ses tournois que si son compte existe et est actif
drop policy if exists "Organisateur peut tout faire sur ses tournois" on public.tournaments;
create policy "Organisateur peut tout faire sur ses tournois"
  on public.tournaments for all
  using (auth.uid() = organizer_id and public.mon_role() is not null)
  with check (auth.uid() = organizer_id and public.mon_role() is not null);

-- Les administrateurs voient et modifient tous les tournois
drop policy if exists "Les administrateurs gèrent tous les tournois" on public.tournaments;
create policy "Les administrateurs gèrent tous les tournois"
  on public.tournaments for all
  using (public.mon_role() in ('principal', 'admin'))
  with check (public.mon_role() in ('principal', 'admin'));

-- =====================================================
-- ADMINISTRATEUR PRINCIPAL
-- =====================================================

insert into public.profiles (id, role, identifiant, nom)
select id, 'principal', 'principal', 'Administrateur principal'
from auth.users
where email = 'VOTRE-EMAIL'
on conflict (id) do update set role = 'principal', actif = true;

-- Vérification : doit afficher une ligne « principal ».
-- Si rien ne s'affiche, l'adresse e-mail ne correspond à aucun compte.
select identifiant, role, actif from public.profiles;
