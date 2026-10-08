# LeCochonnet

Application de tournois de pétanque : l'organisateur crée le tournoi et saisit les scores, le public suit le tableau en direct par QR code. Installable (PWA).

Julien Pichot n'est pas développeur. Réponds en français, explique ce que tu fais en
mots simples, et évite le jargon quand un mot courant suffit.

## Où est quoi

| Élément | Contenu |
|---|---|
| `public/` | **Le site tel qu'il est publié.** Tout ce qui est dans ce dossier est en ligne, rien d'autre. |
| `wrangler.jsonc` | Configuration Cloudflare. Le `name` doit rester `le-cochonnet` : c'est lui qui donne l'adresse. |
| `src/index.js` | Petit serveur : sert `public/` et gère les comptes sous `/api/comptes` (clé secrète Supabase). |
| `docs/` | Notices d'origine, non publiées (si le dossier existe). |

Pas d'étape de construction, pas de dépendances. Les fichiers de `public/` sont statiques ; seul `src/index.js` tourne côté serveur.

## En ligne

- Adresse : https://le-cochonnet.bretonvilliers28.workers.dev/ (Cloudflare Worker `le-cochonnet`, fichiers statiques).
- Code : GitHub privé `Julien028/le-cochonnet` (à créer au premier passage, voir `../LISEZ-MOI-applications.md`).
- Après chaque modification : vérifier dans le navigateur, commit, `git push`.
  Si le dépôt est relié au Worker dans Cloudflare (Settings > Builds), la publication se fait
  toute seule. Sinon : `npx wrangler deploy` dans ce dossier.
- Version de départ : copie du 07/10/2026 des fichiers déposés à la main sur Cloudflare.

## Règles à ne pas perdre en chemin

- L'adresse du site ne doit pas changer : elle est enregistrée sur les téléphones.
- L'appli doit rester pratique sur téléphone.
- Les données sont dans Supabase (base en ligne), pas dans le site : `public/config.js` contient l'adresse du projet et la clé publique « anon ». Ne pas les changer sans raison.
- `docs/supabase-schema.sql` est le schéma de la base. Toute évolution de la base se fait dans Supabase ET dans ce fichier.
- `docs/README-origine.md` est la notice d'origine ; sa partie hébergement (Vercel) n'est plus à jour, le site est sur Cloudflare.
- Si la liste des fichiers du site change, mettre à jour la liste `ASSETS` de `public/service-worker.js` et le numéro de `CACHE_NAME`.
- L'appli enregistre des données dans le navigateur de l'utilisateur (localStorage). Elles sont liées à l'adresse du site : ne jamais changer l'adresse, et ne pas renommer les clés d'enregistrement sans prévoir la reprise des données existantes.

## Comptes (depuis le 08/10/2026)

- Trois rôles, dans la table `profiles` de Supabase : **principal** (Julien, gère tout le monde),
  **admin** (voit et modifie tous les tournois, gère les organisateurs), **organisateur** (ses tournois).
- Plus d'inscription libre : les comptes sont créés dans la page « Comptes » de l'appli.
  Dans Supabase, « Allow new users to sign up » doit rester désactivé.
- Connexion par identifiant : l'identifiant devient une adresse interne
  `identifiant@comptes.le-cochonnet.bretonvilliers28.workers.dev` (même valeur dans `src/index.js` et `public/app.js`).
- Désactiver un compte = blocage de connexion + `actif = false` ; ses tournois restent.
- Le serveur a besoin du secret `SUPABASE_SERVICE_KEY` (Cloudflare > le-cochonnet > Paramètres >
  Variables et secrets). Jamais dans les fichiers. L'adresse Supabase est dans `wrangler.jsonc` ET `public/config.js`.
- Tester en local : fichier `.dev.vars` (ignoré par git) avec SUPABASE_URL et SUPABASE_SERVICE_KEY.
