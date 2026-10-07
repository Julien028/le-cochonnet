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
