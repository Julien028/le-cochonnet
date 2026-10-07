# LeCochonnet

Application web pour organiser des tournois de pétanque. Marche sur ordinateur, iPhone, Android. Installable comme une app (PWA).

## Comment ça marche

- **Toi (l'organisateur)** te connectes sur la page admin avec un mot de passe, tu crées un tournoi, tu ajoutes les équipes, tu rentres les scores au fur et à mesure.
- **Les joueurs et le public** scannent un QR code (ou cliquent sur un lien) et voient le tableau en temps réel sur leur téléphone. Pas de compte à créer, pas d'app à télécharger.

## Pour déployer (compte à faire 1 fois, ~30 min)

### Étape 1 — Créer un compte Supabase (la base de données)

1. Va sur [supabase.com](https://supabase.com) et clique sur **Start your project**
2. Connecte-toi avec GitHub (crée un compte GitHub si tu n'en as pas, c'est gratuit)
3. Clique sur **New project**
   - **Name** : `lecochonnet`
   - **Database password** : génère-en un fort, **note-le quelque part**, tu n'en auras plus besoin après
   - **Region** : choisis `West EU (Paris)` ou `Central EU (Frankfurt)`
4. Attends ~2 minutes que le projet se crée
5. Une fois prêt, dans le menu de gauche, clique sur **SQL Editor**
6. Clique sur **New query**, colle tout le contenu du fichier `supabase-schema.sql` de ce projet, puis clique sur **Run**
   - Tu dois voir "Success. No rows returned"
7. Toujours dans le menu de gauche, clique sur **Project Settings** → **API**
8. **Note ces deux valeurs** (tu vas en avoir besoin) :
   - **Project URL** (ressemble à `https://xxxxx.supabase.co`)
   - **anon public key** (longue chaîne qui commence par `eyJ...`)
9. Dans **Authentication** → **Providers**, vérifie que **Email** est activé (c'est le cas par défaut). Désactive **"Confirm email"** dans les paramètres pour simplifier (sinon faut un serveur mail).

### Étape 2 — Configurer l'app

1. Ouvre le fichier `config.js` dans un éditeur de texte (TextEdit sur Mac, Bloc-notes sur Windows)
2. Remplace les valeurs `À_REMPLIR` par celles que tu as notées à l'étape précédente :

```js
window.LECOCHONNET_CONFIG = {
  SUPABASE_URL: 'https://xxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ...'
};
```

3. Sauvegarde le fichier.

### Étape 3 — Déployer sur Vercel (l'hébergement)

1. Va sur [vercel.com](https://vercel.com) et clique sur **Sign Up**
2. Connecte-toi avec ton compte GitHub
3. Sur le dashboard Vercel, clique sur **Add New...** → **Project**
4. Tu as deux options. La plus simple :
   - Clique sur **"deploy a template"** en bas, puis cherche **"Other"**
   - Ou plus simple encore : retourne sur le dashboard, et **glisse le dossier `lecochonnet`** directement dans la zone d'upload (Vercel a un système de drag-and-drop)
5. **Project Name** : `lecochonnet` (ou ce que tu veux, ça donne l'URL)
6. Clique sur **Deploy**
7. Après ~30 secondes, ton app est en ligne à l'adresse `https://lecochonnet.vercel.app` (ou le nom que tu as choisi)

### Étape 4 — Créer ton compte organisateur

1. Va sur ton URL Vercel et clique sur **"Connexion organisateur"** (ou ajoute `#/login` à la fin de l'URL)
2. Clique sur **"Créer un compte"**
3. Entre ton email et un mot de passe
4. Tu peux maintenant créer ton premier tournoi

## Pour les utilisateurs

- **Pour toi (admin)** : `https://ton-app.vercel.app/#/login`
- **Pour le public** : `https://ton-app.vercel.app/#/t/nom-du-tournoi`
  - L'URL exacte s'affiche dans l'admin une fois le tournoi créé, avec un QR code à imprimer

## Mettre à jour l'app

Si tu modifies un fichier, retourne sur Vercel, clique sur ton projet, et redéploie en glissant le nouveau dossier. La mise à jour est instantanée pour tout le monde.

## Coûts

- **Supabase** : gratuit jusqu'à 500 Mo de données et 50 000 utilisateurs actifs / mois. Tu n'atteindras jamais ces limites pour un usage village.
- **Vercel** : gratuit jusqu'à 100 Go de bande passante / mois. Pareil, tu seras très loin.
- **Total** : 0 € / an.

Si un jour tu veux un nom de domaine genre `tournoi-aunay.fr` à la place de `lecochonnet.vercel.app`, ça coûte ~15 €/an chez OVH ou Gandi, et ça se configure en 5 minutes dans Vercel.

## Si ça plante

Les erreurs les plus probables :
- **"Failed to fetch"** dans la console → tes clés Supabase dans `config.js` sont fausses ou il y a un espace en trop
- **"User not found"** à la connexion → tu n'as pas désactivé la confirmation d'email dans Supabase
- **Le QR code ne marche pas** → vérifie que tu utilises bien le lien `/#/t/...` (public) et pas `/#/admin/...`
