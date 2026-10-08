-- LeCochonnet — base Cloudflare D1 « le-cochonnet » (créée le 08/10/2026, région WEUR)
-- Remplace l'ancienne base Supabase.
-- Appliquer : npx wrangler d1 execute le-cochonnet --remote --file db/schema.sql
-- (sans --remote : base locale de test)

-- Comptes : principal (Julien, gère tout le monde), admin (tous les tournois + organisateurs),
-- organisateur (ses tournois). Le mot de passe n'est jamais gardé en clair.
CREATE TABLE IF NOT EXISTS comptes (
  id INTEGER PRIMARY KEY,
  identifiant TEXT NOT NULL UNIQUE,
  nom TEXT,
  role TEXT NOT NULL CHECK (role IN ('principal', 'admin', 'organisateur')),
  actif INTEGER NOT NULL DEFAULT 1,
  mot_de_passe TEXT NOT NULL,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par INTEGER REFERENCES comptes(id)
);

-- Connexions ouvertes (cookie), un an, prolongé à l'usage
CREATE TABLE IF NOT EXISTS sessions (
  jeton TEXT PRIMARY KEY,
  compte_id INTEGER NOT NULL REFERENCES comptes(id) ON DELETE CASCADE,
  expire_le TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_compte ON sessions (compte_id);

-- Tournois : tout l'état (équipes, poules, scores, tableaux, planning, plan) est en JSON
CREATE TABLE IF NOT EXISTS tournois (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  nom TEXT NOT NULL,
  organisateur_id INTEGER REFERENCES comptes(id) ON DELETE SET NULL,
  etat TEXT NOT NULL DEFAULT '{}',
  public INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  modifie_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS tournois_organisateur ON tournois (organisateur_id);
