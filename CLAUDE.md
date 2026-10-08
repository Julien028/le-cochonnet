# LeCochonnet

Application de tournois de pétanque : l'organisateur crée le tournoi et saisit les scores, le public suit le tableau en direct par QR code. Installable (PWA).

Julien Pichot n'est pas développeur. Réponds en français, explique ce que tu fais en
mots simples, et évite le jargon quand un mot courant suffit.

## Où est quoi

| Élément | Contenu |
|---|---|
| `public/` | Les pages de l'appli (fichiers statiques). Tout le moteur du tournoi est dans `public/app.js`. |
| `src/` | Le petit serveur : connexion, comptes et tournois sous `/api/` (`index.js`), mots de passe et cookie (`session.js`). |
| `db/schema.sql` | Structure de la base Cloudflare D1 `le-cochonnet`. |
| `scripts/compte.mjs` | Crée un compte ou redonne un mot de passe directement dans la base (premier compte, secours). |
| `wrangler.jsonc` | Configuration Cloudflare. Le `name` doit rester `le-cochonnet` : c'est lui qui donne l'adresse. |
| `docs/` | Notice d'origine, non publiée. |

Pas d'étape de construction, pas de dépendances.

## En ligne

- Adresse : https://le-cochonnet.bretonvilliers28.workers.dev/ (Cloudflare Worker `le-cochonnet`).
- Compte Cloudflare : bretonvilliers28@gmail.com (compte personnel de Julien, c'est voulu).
- Code : GitHub privé `Julien028/le-cochonnet`, relié au Worker : **un `git push` publie le site**
  (en ~30 s). Ne pousser qu'avec l'accord de Julien, puis vérifier en ligne.
- Base : Cloudflare D1 `le-cochonnet` (id `01eb4954-cf85-41ba-bf9c-8571ce14fdb9`, région WEUR),
  créée le 08/10/2026. Elle remplace Supabase (abandonné, on est reparti de zéro).
- Version de départ : copie du 07/10/2026 des fichiers déposés à la main sur Cloudflare.

## Règles à ne pas perdre en chemin

- L'adresse du site ne doit pas changer : elle est enregistrée sur les téléphones.
- L'appli doit rester pratique sur téléphone.
- Toute évolution de la base se fait dans `db/schema.sql` ET en ligne
  (`npx wrangler d1 execute le-cochonnet --remote --file ...`). Ne jamais vider une table.
- Le moteur du tournoi travaille sur un état JSON (`state`) ; le serveur le range tel quel.
  Les noms de champs envoyés au navigateur (`name`, `state`, `organizer_id`…) sont ceux d'avant : ne pas les changer.
- Mise à jour en direct : la page publique demande toutes les 5 s la `version` du tournoi
  et ne recharge le tournoi que s'il a changé. Pas de requête quand l'appli est en arrière-plan.
- `docs/README-origine.md` est la notice d'origine ; ses parties Supabase et Vercel ne sont plus à jour.
- Si la liste des fichiers du site change, mettre à jour la liste `ASSETS` de `public/service-worker.js` et le numéro de `CACHE_NAME`.
- L'appli enregistre des données dans le navigateur de l'utilisateur (localStorage : compteur, duel, plans,
  « Mon équipe »). Elles sont liées à l'adresse du site : ne jamais changer l'adresse, et ne pas renommer
  les clés d'enregistrement sans prévoir la reprise des données existantes.

## Comptes

- Trois rôles : **principal** (Julien, identifiant `julien` : gère tout le monde),
  **admin** (voit et modifie tous les tournois, gère les organisateurs), **organisateur** (ses tournois).
- Pas d'inscription libre : les comptes sont créés dans la page « Comptes » de l'appli.
- Connexion par identifiant + mot de passe ; cookie d'un an. Mots de passe jamais en clair (PBKDF2,
  même méthode que le site des heures).
- Désactiver un compte le déconnecte partout ; ses tournois restent. Un nouveau mot de passe aussi.
- Mot de passe du principal perdu : `node scripts/compte.mjs julien principal "Julien"`, puis lancer
  la commande affichée.

## Tester en local

Volet d'aperçu : configuration `le-cochonnet` (port 8791) dans `../Site-ferme/.claude/launch.json`.
Base de test locale : `npx wrangler d1 execute le-cochonnet --local --file db/schema.sql`, puis
`node scripts/compte.mjs essai principal "Essai" --local` et la commande affichée.
