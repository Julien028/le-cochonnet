// LeCochonnet — Serveur du site
// =============================
// Sert les fichiers de public/ et, sous /api/, la connexion, les comptes et les tournois,
// rangés dans la base Cloudflare D1 « le-cochonnet » (voir db/schema.sql).
// Tout repose sur des outils standard (fetch, Web Crypto, SQL) : rien à réécrire
// si l'on change un jour d'hébergeur.

import { hacher, verifier, nouveauJeton, cookieSession, lireJeton, EXPIRATION } from './session.js';

const ROLES = ['principal', 'admin', 'organisateur'];
// Un tournoi avec un plan photo pèse quelques centaines de Ko ; D1 accepte 2 Mo par ligne
const TAILLE_MAX_ETAT = 1800000;

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

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}
const erreur = (status, message) => json({ erreur: message }, status);

const estAdmin = c => !!c && (c.role === 'principal' || c.role === 'admin');

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

const peutModifierTournoi = (moi, t) => !!moi && (estAdmin(moi) || t.organisateur_id === moi.id);

function verifierMotDePasse(mdp) {
  if (typeof mdp !== 'string' || mdp.length < 8) return 'Le mot de passe doit faire au moins 8 caractères.';
  if (mdp.length > 200) return 'Le mot de passe est trop long.';
  return null;
}

function slugify(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'tournoi';
}

async function compteConnecte(request, env) {
  const jeton = lireJeton(request);
  if (!jeton) return null;
  const c = await env.DB.prepare(
    `SELECT c.id, c.identifiant, c.nom, c.role, s.expire_le
       FROM sessions s JOIN comptes c ON c.id = s.compte_id
      WHERE s.jeton = ? AND s.expire_le > datetime('now') AND c.actif = 1`
  ).bind(jeton).first();
  if (!c) return null;
  // Prolongation, au plus une fois par mois, pour ne pas écrire à chaque clic
  const { prolonger } = await env.DB.prepare("SELECT ? < datetime('now', '+335 days') AS prolonger").bind(c.expire_le).first();
  if (prolonger) await env.DB.prepare("UPDATE sessions SET expire_le = datetime('now', ?) WHERE jeton = ?").bind(EXPIRATION, jeton).run();
  return { id: c.id, identifiant: c.identifiant, nom: c.nom, role: c.role };
}

// Forme envoyée au navigateur (mêmes noms qu'avant, pour ne pas toucher au moteur du tournoi)
function tournoiPourNavigateur(t, { sansPlan = false } = {}) {
  let state = {};
  try { state = JSON.parse(t.etat); } catch {}
  if (sansPlan && state) delete state.planTerrains;
  return {
    id: t.id, slug: t.slug, name: t.nom, organizer_id: t.organisateur_id, organizer_name: t.organisateur_nom ?? null,
    state, is_public: !!t.public, version: t.version, created_at: t.cree_le
  };
}

async function api(request, env, url) {
  const methode = request.method;
  // Une écriture doit venir de nos propres pages : même origine, et du JSON
  if (methode !== 'GET') {
    const origine = request.headers.get('origin');
    if (origine && origine !== url.origin) return erreur(403, 'Origine refusée.');
    if (methode !== 'DELETE' && !(request.headers.get('content-type') || '').includes('application/json')) return erreur(415, 'JSON attendu.');
  }
  const corps = (methode === 'POST' || methode === 'PUT' || methode === 'PATCH') ? await request.json().catch(() => ({})) : {};
  const p = url.pathname.split('/').filter(Boolean).slice(1); // sans « api »
  const moi = await compteConnecte(request, env);

  // ---------- Connexion ----------
  if (p[0] === 'connexion' && methode === 'POST') {
    const identifiant = String(corps.identifiant || '').trim().toLowerCase();
    const c = await env.DB.prepare('SELECT * FROM comptes WHERE identifiant = ?').bind(identifiant).first();
    // Même réponse que le compte existe ou non
    if (!c || !(await verifier(String(corps.motDePasse || ''), c.mot_de_passe))) return erreur(401, 'Identifiant ou mot de passe incorrect.');
    if (!c.actif) return erreur(403, 'Ce compte est désactivé. Demandez à un administrateur de le réactiver.');
    const jeton = nouveauJeton();
    await env.DB.prepare("INSERT INTO sessions (jeton, compte_id, expire_le) VALUES (?, ?, datetime('now', ?))").bind(jeton, c.id, EXPIRATION).run();
    return json({ compte: { id: c.id, identifiant: c.identifiant, nom: c.nom, role: c.role } }, 200, { 'set-cookie': cookieSession(jeton) });
  }
  if (p[0] === 'deconnexion' && methode === 'POST') {
    const jeton = lireJeton(request);
    if (jeton) await env.DB.prepare('DELETE FROM sessions WHERE jeton = ?').bind(jeton).run();
    return json({ ok: true }, 200, { 'set-cookie': cookieSession('') });
  }
  if (p[0] === 'moi' && p.length === 1 && methode === 'GET') return json({ compte: moi });
  if (p[0] === 'moi' && p[1] === 'mot-de-passe' && methode === 'POST') {
    if (!moi) return erreur(401, 'Connexion nécessaire.');
    const e = verifierMotDePasse(corps.motDePasse);
    if (e) return erreur(400, e);
    await env.DB.prepare('UPDATE comptes SET mot_de_passe = ? WHERE id = ?').bind(await hacher(corps.motDePasse), moi.id).run();
    // Les autres appareils devront se reconnecter
    await env.DB.prepare('DELETE FROM sessions WHERE compte_id = ? AND jeton <> ?').bind(moi.id, lireJeton(request)).run();
    return json({ ok: true });
  }

  // ---------- Tournois ----------
  if (p[0] === 'tournois') {
    // Lecture d'un tournoi : publique si le tournoi est public
    if (p.length >= 2 && methode === 'GET') {
      const t = await env.DB.prepare('SELECT * FROM tournois WHERE slug = ?').bind(p[1]).first();
      const visible = t && (t.public || peutModifierTournoi(moi, t));
      if (!visible) return erreur(404, 'Tournoi introuvable ou non public.');
      // Petite question posée toutes les 5 s par les téléphones du public : « ça a changé ? »
      if (p[2] === 'version') return json({ version: t.version });
      return json({ tournoi: { ...tournoiPourNavigateur(t), peutModifier: peutModifierTournoi(moi, t) } });
    }

    if (!moi) return erreur(401, 'Connexion nécessaire.');

    if (p.length === 1 && methode === 'GET') {
      const sql = `SELECT t.*, COALESCE(c.nom, c.identifiant) AS organisateur_nom
                     FROM tournois t LEFT JOIN comptes c ON c.id = t.organisateur_id
                    ${estAdmin(moi) ? '' : 'WHERE t.organisateur_id = ?'}
                    ORDER BY t.cree_le DESC, t.id DESC`;
      const q = env.DB.prepare(sql);
      const { results } = await (estAdmin(moi) ? q : q.bind(moi.id)).all();
      return json({ tournois: results.map(t => tournoiPourNavigateur(t, { sansPlan: true })) });
    }

    if (p.length === 1 && methode === 'POST') {
      const nom = String(corps.nom || '').trim().slice(0, 120);
      if (!nom) return erreur(400, 'Donnez un nom au tournoi.');
      const etat = JSON.stringify(corps.etat || {});
      const base = slugify(nom);
      for (let essai = 0; essai < 6; essai++) {
        const slug = essai === 0 ? base : `${base}-${nouveauJeton().slice(0, 4)}`;
        const r = await env.DB.prepare('INSERT INTO tournois (slug, nom, organisateur_id, etat) VALUES (?, ?, ?, ?) ON CONFLICT (slug) DO NOTHING RETURNING *')
          .bind(slug, nom, moi.id, etat).first();
        if (r) return json({ tournoi: tournoiPourNavigateur(r) }, 201);
      }
      return erreur(409, 'Choisissez un autre nom de tournoi.');
    }

    if (p.length >= 2) {
      const t = await env.DB.prepare('SELECT * FROM tournois WHERE slug = ?').bind(p[1]).first();
      if (!t) return erreur(404, 'Tournoi introuvable.');
      if (!peutModifierTournoi(moi, t)) return erreur(403, 'Ce tournoi ne vous appartient pas.');

      if (p[2] === 'etat' && methode === 'PUT') {
        const etat = JSON.stringify(corps.etat || {});
        if (etat.length > TAILLE_MAX_ETAT) return erreur(413, 'Tournoi trop lourd : essayez un plan de terrains plus léger.');
        const r = await env.DB.prepare("UPDATE tournois SET etat = ?, version = version + 1, modifie_le = datetime('now') WHERE id = ? RETURNING version")
          .bind(etat, t.id).first();
        return json({ version: r.version });
      }
      if (p.length === 2 && methode === 'PATCH') {
        const nom = String(corps.nom || '').trim().slice(0, 120);
        if (!nom) return erreur(400, 'Donnez un nom au tournoi.');
        await env.DB.prepare("UPDATE tournois SET nom = ?, version = version + 1, modifie_le = datetime('now') WHERE id = ?").bind(nom, t.id).run();
        return json({ ok: true });
      }
      if (p.length === 2 && methode === 'DELETE') {
        await env.DB.prepare('DELETE FROM tournois WHERE id = ?').bind(t.id).run();
        return json({ ok: true });
      }
    }
    return erreur(404, 'Adresse inconnue.');
  }

  // ---------- Comptes (administrateurs) ----------
  if (p[0] === 'comptes') {
    if (!moi) return erreur(401, 'Connexion expirée ou compte désactivé. Reconnectez-vous.');
    if (!estAdmin(moi)) return erreur(403, 'Réservé aux administrateurs.');

    if (p.length === 1 && methode === 'GET') {
      const { results } = await env.DB.prepare('SELECT id, role, identifiant, nom, actif, cree_le FROM comptes ORDER BY id').all();
      return json({ moi: { id: moi.id, role: moi.role }, comptes: results.map(c => ({ ...c, actif: !!c.actif })) });
    }

    if (p.length === 1 && methode === 'POST') {
      const role = corps.role;
      const nom = String(corps.nom || '').trim().slice(0, 80) || null;
      const identifiant = String(corps.identifiant || '').trim().toLowerCase();
      if (!ROLES.includes(role) || !peutCreer(moi, role)) return erreur(403, 'Vous ne pouvez pas créer ce type de compte.');
      if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(identifiant)) {
        return erreur(400, 'Identifiant : 3 à 30 caractères, lettres sans accent, chiffres, point, tiret.');
      }
      const e = verifierMotDePasse(corps.motDePasse);
      if (e) return erreur(400, e);
      const r = await env.DB.prepare('INSERT INTO comptes (identifiant, nom, role, mot_de_passe, cree_par) VALUES (?, ?, ?, ?, ?) ON CONFLICT (identifiant) DO NOTHING RETURNING id, role, identifiant, nom, actif')
        .bind(identifiant, nom, role, await hacher(corps.motDePasse), moi.id).first();
      if (!r) return erreur(409, 'Cet identifiant est déjà pris.');
      return json({ compte: { ...r, actif: !!r.actif } }, 201);
    }

    if (p.length === 3 && methode === 'POST') {
      const cible = await env.DB.prepare('SELECT id, role FROM comptes WHERE id = ?').bind(Number(p[1])).first();
      if (!cible) return erreur(404, 'Compte introuvable.');
      if (!peutGerer(moi, cible)) return erreur(403, 'Vous ne pouvez pas modifier ce compte.');

      if (p[2] === 'mot-de-passe') {
        const e = verifierMotDePasse(corps.motDePasse);
        if (e) return erreur(400, e);
        await env.DB.batch([
          env.DB.prepare('UPDATE comptes SET mot_de_passe = ? WHERE id = ?').bind(await hacher(corps.motDePasse), cible.id),
          env.DB.prepare('DELETE FROM sessions WHERE compte_id = ?').bind(cible.id)
        ]);
        return json({ ok: true });
      }
      if (p[2] === 'actif') {
        // Un compte désactivé est déconnecté partout ; ses tournois restent en place
        const actif = corps.actif === true ? 1 : 0;
        const ordres = [env.DB.prepare('UPDATE comptes SET actif = ? WHERE id = ?').bind(actif, cible.id)];
        if (!actif) ordres.push(env.DB.prepare('DELETE FROM sessions WHERE compte_id = ?').bind(cible.id));
        await env.DB.batch(ordres);
        return json({ ok: true });
      }
    }
  }

  return erreur(404, 'Adresse inconnue.');
}
