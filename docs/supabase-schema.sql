-- LeCochonnet — Schéma de base de données
-- À coller dans le SQL Editor de Supabase et exécuter

-- =====================================================
-- TABLE PRINCIPALE : tournaments
-- Tout l'état du tournoi est stocké dans une colonne JSONB
-- (équipes, poules, matchs, scores, brackets...)
-- =====================================================

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  organizer_id uuid references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  is_public boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index tournaments_slug_idx on public.tournaments (slug);
create index tournaments_organizer_idx on public.tournaments (organizer_id);

-- Trigger pour mettre à jour updated_at automatiquement
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tournaments_updated_at
  before update on public.tournaments
  for each row execute function update_updated_at();

-- =====================================================
-- ROW LEVEL SECURITY (qui a le droit de faire quoi)
-- =====================================================

alter table public.tournaments enable row level security;

-- Le public peut LIRE les tournois publics
create policy "Public peut voir les tournois publics"
  on public.tournaments
  for select
  using (is_public = true);

-- Un organisateur peut TOUT faire sur ses propres tournois
create policy "Organisateur peut tout faire sur ses tournois"
  on public.tournaments
  for all
  using (auth.uid() = organizer_id)
  with check (auth.uid() = organizer_id);

-- =====================================================
-- REALTIME (synchro en direct entre les téléphones)
-- =====================================================

-- Active la publication realtime sur la table tournaments
alter publication supabase_realtime add table public.tournaments;

-- =====================================================
-- COMPTES (ajouté le 08/10/2026)
-- Installation sur une base existante : docs/supabase-comptes.sql
-- (il crée aussi l'administrateur principal).
-- Les règles ci-dessous REMPLACENT la règle « Organisateur peut tout faire » plus haut.
-- =====================================================

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
