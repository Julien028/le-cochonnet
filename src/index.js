// LeCochonnet — Serveur du site
// =============================
// Sert les fichiers de public/ et, sous /api/comptes, gère les comptes
// (création, mot de passe, désactivation). Ces actions demandent la clé secrète
// de Supabase, qui reste ici, côté serveur, et n'est jamais envoyée au navigateur.
//
// Réglages (Cloudflare > le-cochonnet > Paramètres > Variables et secrets) :
//   SUPABASE_URL          adresse du projet Supabase (dans wrangler.jsonc)
//   SUPABASE_SERVICE_KEY  clé secrète « service_role » (secret, saisi dans Cloudflare)

// Les comptes créés par identifiant reçoivent une adresse interne, jamais utilisée pour écrire
const DOMAINE_IDENTIFIANT = 'comptes.le-cochonnet.bretonvilliers28.workers.dev';

const ROLES = ['principal', 'admin', 'organisateur'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url);
      } catch (e) {
        console.error(e);
        return json({ erreur: 'Erreur du serveur, réessayez dans un instant.' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

// Appel à Supabase avec la clé secrète
async function sb(env, chemin, { method = 'GET', body, headers = {} } = {}) {
  const r = await fetch(env.SUPABASE_URL + chemin, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY,
      'content-type': 'application/json',
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const texte = await r.text();
  let data = null;
  try { data = texte ? JSON.parse(texte) : null; } catch { data = texte; }
  return { ok: r.ok, status: r.status, data };
}

async function lireProfil(env, id) {
  const r = await sb(env, `/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=*`);
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

// Qui fait la demande ? (d'après le jeton de connexion envoyé par le navigateur)
async function demandeur(request, env) {
  const jeton = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jeton) return null;
  const r = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: 'Bearer ' + jeton }
  });
  if (!r.ok) return null;
  const user = await r.json();
  const profil = await lireProfil(env, user.id);
  if (!profil || !profil.actif) return null;
  return profil;
}

// Le principal gère tout le monde sauf lui-même ; un administrateur gère les organisateurs
function peutGerer(moi, cible) {
  if (moi.id === cible.id) return false;
  if (moi.role === 'principal') return cible.role !== 'principal';
  if (moi.role === 'admin') return cible.role === 'organisateur';
  return false;
}

function peutCreer(moi, role) {
  if (moi.role === 'principal') return role === 'admin' || role === 'organisateur';
  if (moi.role === 'admin') return role === 'organisateur';
  return false;
}

function verifierMotDePasse(mdp) {
  if (typeof mdp !== 'string' || mdp.length < 8) return 'Le mot de passe doit faire au moins 8 caractères.';
  if (mdp.length > 72) return 'Le mot de passe est trop long.';
  return null;
}

async function api(request, env, url) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ erreur: 'La gestion des comptes n’est pas encore activée sur le serveur (clé secrète manquante).' }, 503);
  }
  const moi = await demandeur(request, env);
  if (!moi) return json({ erreur: 'Connexion expirée ou compte désactivé. Reconnectez-vous.' }, 401);
  if (moi.role !== 'principal' && moi.role !== 'admin') {
    return json({ erreur: 'Réservé aux administrateurs.' }, 403);
  }

  const parties = url.pathname.split('/').filter(Boolean); // ['api', 'comptes', id?, action?]
  if (parties[1] !== 'comptes') return json({ erreur: 'Adresse inconnue.' }, 404);
  const corps = request.method === 'POST' ? await request.json().catch(() => ({})) : {};

  // Liste des comptes
  if (parties.length === 2 && request.method === 'GET') {
    const r = await sb(env, '/rest/v1/profiles?select=id,role,identifiant,nom,actif,created_at&order=created_at.asc');
    if (!r.ok) return json({ erreur: 'Lecture des comptes impossible.' }, 502);
    return json({ moi: { id: moi.id, role: moi.role }, comptes: r.data });
  }

  // Création d'un compte
  if (parties.length === 2 && request.method === 'POST') {
    const role = corps.role;
    const nom = String(corps.nom || '').trim().slice(0, 80);
    const identifiant = String(corps.identifiant || '').trim().toLowerCase();
    if (!ROLES.includes(role) || !peutCreer(moi, role)) return json({ erreur: 'Vous ne pouvez pas créer ce type de compte.' }, 403);
    if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(identifiant)) {
      return json({ erreur: 'Identifiant : 3 à 30 caractères, lettres sans accent, chiffres, point, tiret.' }, 400);
    }
    const erreurMdp = verifierMotDePasse(corps.motDePasse);
    if (erreurMdp) return json({ erreur: erreurMdp }, 400);

    const deja = await sb(env, `/rest/v1/profiles?identifiant=eq.${encodeURIComponent(identifiant)}&select=id`);
    if (deja.ok && deja.data.length) return json({ erreur: 'Cet identifiant est déjà pris.' }, 409);

    const cree = await sb(env, '/auth/v1/admin/users', {
      method: 'POST',
      body: {
        email: `${identifiant}@${DOMAINE_IDENTIFIANT}`,
        password: corps.motDePasse,
        email_confirm: true,
        user_metadata: { identifiant, nom }
      }
    });
    if (!cree.ok) return json({ erreur: 'Création refusée par la base : ' + (cree.data?.msg || cree.data?.message || cree.status) }, 400);

    const profil = await sb(env, '/rest/v1/profiles', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: { id: cree.data.id, role, identifiant, nom: nom || null, created_by: moi.id }
    });
    if (!profil.ok) {
      // On ne laisse pas un compte sans fiche
      await sb(env, `/auth/v1/admin/users/${cree.data.id}`, { method: 'DELETE' });
      return json({ erreur: 'Création impossible (fiche du compte).' }, 502);
    }
    return json({ compte: profil.data[0] }, 201);
  }

  // Actions sur un compte existant
  if (parties.length === 4 && request.method === 'POST') {
    const cible = await lireProfil(env, parties[2]);
    if (!cible) return json({ erreur: 'Compte introuvable.' }, 404);
    if (!peutGerer(moi, cible)) return json({ erreur: 'Vous ne pouvez pas modifier ce compte.' }, 403);

    if (parties[3] === 'mot-de-passe') {
      const erreurMdp = verifierMotDePasse(corps.motDePasse);
      if (erreurMdp) return json({ erreur: erreurMdp }, 400);
      const r = await sb(env, `/auth/v1/admin/users/${cible.id}`, { method: 'PUT', body: { password: corps.motDePasse } });
      if (!r.ok) return json({ erreur: 'Changement refusé par la base.' }, 502);
      return json({ ok: true });
    }

    if (parties[3] === 'actif') {
      const actif = corps.actif === true;
      // Un compte désactivé ne peut plus se connecter ; ses tournois restent en place
      const r = await sb(env, `/auth/v1/admin/users/${cible.id}`, {
        method: 'PUT',
        body: { ban_duration: actif ? 'none' : '876000h' }
      });
      if (!r.ok) return json({ erreur: 'Changement refusé par la base.' }, 502);
      const p = await sb(env, `/rest/v1/profiles?id=eq.${cible.id}`, { method: 'PATCH', body: { actif } });
      if (!p.ok) return json({ erreur: 'Changement incomplet, réessayez.' }, 502);
      return json({ ok: true });
    }
  }

  return json({ erreur: 'Adresse inconnue.' }, 404);
}
