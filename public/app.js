// LeCochonnet — Application principale (v2)
// ==========================================

// ============== SETUP ==============

// Les données (comptes, tournois) sont gardées par le serveur du site (src/index.js),
// dans la base Cloudflare D1. Le navigateur lui parle par /api/.

async function appelServeur(chemin, { method = 'GET', body } = {}) {
  const r = await fetch(chemin, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const res = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(res.erreur || 'Erreur ' + r.status);
    e.status = r.status;
    throw e;
  }
  return res;
}

const app = document.getElementById('app');

const STATE = {
  user: undefined, // compte connecté ; undefined = pas encore demandé au serveur, null = personne
  profil: null,
  tournament: null,
  mode: 'admin',
  realtimeChannel: null, // minuterie qui guette les mises à jour d'un tournoi
  saveTimer: null,
  savePending: false,
  activeTab: 'tournoi', // 'tournoi' | 'plan' | 'planning' | 'reglement' | 'compteur'
  activeBracket: 'principal' // sous-onglet des finales : 'principal' | 'conso'
};

// ============== UTILS ==============

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function escapeHtml(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function slugify(s) {
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'tournoi';
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toast(msg) {
  const existing = $('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

// Confirmation forte : l'utilisateur doit taper un mot précis pour valider une action destructrice.
// Renvoie une promesse qui résout true (confirmé) ou false (annulé).
function confirmFort({ titre, message, motAValider = 'EFFACER', boutonLabel = 'Confirmer' }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-bg';
    wrap.innerHTML = `
      <div class="modal">
        <h2 style="color: var(--danger);">${escapeHtml(titre)}</h2>
        <p>${message}</p>
        <p class="tiny muted mb-2">Pour confirmer, tape le mot <strong>${escapeHtml(motAValider)}</strong> ci-dessous :</p>
        <input type="text" id="confirm-fort-input" placeholder="${escapeHtml(motAValider)}" autocomplete="off" autocapitalize="characters" />
        <div class="modal-actions">
          <button class="ghost" id="confirm-fort-cancel">Annuler</button>
          <button class="danger" id="confirm-fort-ok" disabled>${escapeHtml(boutonLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    const input = wrap.querySelector('#confirm-fort-input');
    const okBtn = wrap.querySelector('#confirm-fort-ok');
    input.focus();
    const check = () => {
      okBtn.disabled = input.value.trim().toUpperCase() !== motAValider.toUpperCase();
    };
    input.addEventListener('input', check);
    const close = (result) => { wrap.remove(); resolve(result); };
    wrap.querySelector('#confirm-fort-cancel').addEventListener('click', () => close(false));
    okBtn.addEventListener('click', () => { if (!okBtn.disabled) close(true); });
    wrap.addEventListener('click', e => { if (e.target === wrap) close(false); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !okBtn.disabled) close(true); });
  });
}

// Modale de validation des poules : confirme + fixe l'heure de début des finales
function promptValiderPoules() {
  const s = STATE.tournament.state;
  // Heure proposée par défaut = fin des poules + 10 min
  const dur = effectiveSlotDuration(s);
  const lastPoule = (s.planning && s.planning.poules && s.planning.poules.length > 0)
    ? s.planning.poules[s.planning.poules.length - 1].time
    : s.config.heureDebut;
  const heureProposee = s.config.heureFinales || addMinutes(lastPoule, dur + 10);

  const wrap = document.createElement('div');
  wrap.className = 'modal-bg';
  wrap.innerHTML = `
    <div class="modal">
      <h2>Valider les poules</h2>
      <p>Les scores de poule seront <strong>figés</strong> et la phase finale activée pour tout le monde.</p>
      <label class="field mt-2">
        <span class="label-text">À quelle heure commence la phase finale ?</span>
        <input type="time" id="vp-heure-finales" value="${escapeHtml(heureProposee)}" />
      </label>
      <p class="tiny muted mb-2">Laisse cette heure pour enchaîner, ou repousse-la pour laisser une pause (repas, etc.).</p>
      <p class="tiny muted mb-2">Pour confirmer, tape le mot <strong>VALIDER</strong> :</p>
      <input type="text" id="vp-mot" placeholder="VALIDER" autocomplete="off" autocapitalize="characters" />
      <div class="modal-actions">
        <button class="ghost" id="vp-cancel">Annuler</button>
        <button class="primary" id="vp-ok" disabled>Valider et lancer les finales</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const motInput = wrap.querySelector('#vp-mot');
  const okBtn = wrap.querySelector('#vp-ok');
  motInput.focus();
  motInput.addEventListener('input', () => {
    okBtn.disabled = motInput.value.trim().toUpperCase() !== 'VALIDER';
  });
  const close = () => wrap.remove();
  wrap.querySelector('#vp-cancel').addEventListener('click', close);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  okBtn.addEventListener('click', () => {
    if (okBtn.disabled) return;
    const hf = wrap.querySelector('#vp-heure-finales').value;
    s.config.heureFinales = hf || null;
    generateBrackets();
    computeBracketSchedule();
    s.poulesVerrouillees = true;
    s.step = 'brackets';
    scheduleSave();
    close();
    renderTournoiTab($('#tab-content'));
  });
}

// Format helpers
function formatLabel(fmt) {
  return fmt === 'points' ? '13 points' : fmt.replace('temps', '') + ' min';
}

// Plafond de saisie d'un score. Dans tous les formats, le premier à 13 points gagne,
// donc le score ne dépasse jamais 13 (au temps, atteindre 13 met fin au match).
function maxScoreForFormat(fmt) {
  return 13;
}

// Plafond pour le tournoi courant
function maxScore() {
  const s = STATE.tournament && STATE.tournament.state;
  return maxScoreForFormat(s ? s.config.format : 'points');
}

function matchDuration(fmt) {
  if (fmt === 'temps10') return 10;
  if (fmt === 'temps15') return 15;
  if (fmt === 'temps20') return 20;
  if (fmt === 'temps25') return 25;
  if (fmt === 'temps30') return 30;
  if (fmt === 'points') return 30; // estimation
  return 15;
}

// Durée effective d'un match pour le tournoi courant (tient compte d'un éventuel ajustement manuel)
function effectiveMatchDuration(s) {
  if (s.config.dureeMatchOverride != null) return s.config.dureeMatchOverride;
  return matchDuration(s.config.format);
}

// Durée d'un créneau = durée d'un match + pause
function effectiveSlotDuration(s) {
  return effectiveMatchDuration(s) + (s.config.pauseEntreMatchs != null ? s.config.pauseEntreMatchs : 5);
}

function slotDuration(fmt, pause) {
  return matchDuration(fmt) + (pause != null ? pause : 5);
}

// Convertit "14:00" + N minutes en "14:25"
function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + mins;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return String(nh).padStart(2, '0') + ':' + String(nm).padStart(2, '0');
}

// Le score est-il "fait" (les deux valeurs renseignées) ?
function isMatchDecided(m) {
  return m && m.scoreA != null && m.scoreB != null;
}

function defaultState() {
  return {
    step: 'teams',
    teams: [],
    config: {
      format: 'temps15',
      pouleMode: 'size', // 'size' (par taille) ou 'count' (par nombre)
      pouleSize: 4,
      nbPoules: 4,
      qualif: 2,
      qualifMode: 'parPoule', // 'parPoule' ou 'tableau'
      tableauSize: 8,
      nbTerrains: 4,
      heureDebut: '14:00',
      pauseEntreMatchs: 5
    },
    poules: [],
    poulesVerrouillees: false,
    brPrincipal: null,
    brConso: null,
    petiteFinalePrincipal: null,
    petiteFinaleConso: null,
    planning: null,
    planTerrains: null
  };
}

// ============== ROUTER ==============

function navigate(hash) { window.location.hash = hash; }

function parseRoute() {
  const h = window.location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'login') return { name: 'login' };
  if (parts[0] === 'signup') return { name: 'login' }; // inscription libre fermée : comptes créés par les administrateurs
  if (parts[0] === 'comptes') return { name: 'comptes' };
  if (parts[0] === 'mot-de-passe') return { name: 'mot-de-passe' };
  if (parts[0] === 'compteur') return { name: 'compteur' };
  if (parts[0] === 'duel') return { name: 'duel' };
  if (parts[0] === 'mesure') return { name: 'mesure' };
  if (parts[0] === 'admin' && parts[1]) return { name: 'admin', slug: parts[1] };
  if (parts[0] === 't' && parts[1]) return { name: 'public', slug: parts[1] };
  return { name: 'home' };
}

async function route() {
  const r = parseRoute();
  cleanupRealtime();
  if (STATE.user === undefined) await chargerCompte();
  if (r.name === 'home') return renderHome();
  if (r.name === 'login') return renderLogin();
  if (r.name === 'comptes') return renderComptes();
  if (r.name === 'mot-de-passe') return renderMonMotDePasse();
  if (r.name === 'compteur') return renderCompteur();
  if (r.name === 'duel') return renderDuel();
  if (r.name === 'mesure') return renderMesure();
  if (r.name === 'admin') {
    if (!STATE.user) { navigate('#/login'); return; }
    return loadAndRenderAdmin(r.slug);
  }
  if (r.name === 'public') return loadAndRenderPublic(r.slug);
}

window.addEventListener('hashchange', route);

// ============== AUTH ==============

async function signIn(identifiant, password) {
  const r = await appelServeur('/api/connexion', { method: 'POST', body: { identifiant, motDePasse: password } });
  STATE.user = r.compte;
  STATE.profil = r.compte;
  return r.compte;
}

async function signOut() {
  await appelServeur('/api/deconnexion', { method: 'POST', body: {} }).catch(() => {});
  STATE.user = null;
  STATE.profil = null;
  navigate('#/');
}

// ============== DATA ==============

// Les administrateurs reçoivent les tournois de tout le monde, les organisateurs les leurs
async function listMyTournaments() {
  return (await appelServeur('/api/tournois')).tournois;
}

async function createTournament(name) {
  return (await appelServeur('/api/tournois', { method: 'POST', body: { nom: name, etat: defaultState() } })).tournoi;
}

async function getTournament(slug) {
  try {
    return (await appelServeur('/api/tournois/' + encodeURIComponent(slug))).tournoi;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function saveState(id, state) {
  const t = STATE.tournament;
  STATE.savePending = true;
  renderSaveIndicator();
  try {
    const r = await appelServeur(`/api/tournois/${encodeURIComponent(t.slug)}/etat`, { method: 'PUT', body: { etat: state } });
    t.version = r.version;
  } catch (e) {
    toast('Erreur de sauvegarde : ' + e.message);
    console.error(e);
  }
  STATE.savePending = false;
  renderSaveIndicator();
}

async function renameTournament(id, name) {
  await appelServeur('/api/tournois/' + encodeURIComponent(STATE.tournament.slug), { method: 'PATCH', body: { nom: name } });
}

async function deleteTournamentBySlug(slug) {
  await appelServeur('/api/tournois/' + encodeURIComponent(slug), { method: 'DELETE' });
}

function scheduleSave() {
  if (!STATE.tournament) return;
  if (STATE.saveTimer) clearTimeout(STATE.saveTimer);
  STATE.saveTimer = setTimeout(() => {
    saveState(STATE.tournament.id, STATE.tournament.state);
  }, 600);
}

// Mise à jour en direct : toutes les 5 secondes, on demande au serveur si le tournoi a changé
// (une toute petite question), et on ne recharge le tournoi entier que s'il a changé.
function subscribeToTournament(id, onUpdate) {
  cleanupRealtime();
  const slug = STATE.tournament.slug;
  let version = STATE.tournament.version;
  const verifier = async () => {
    // Téléphone en veille ou appli en arrière-plan : on ne consomme rien
    if (document.hidden) return;
    try {
      const r = await appelServeur(`/api/tournois/${encodeURIComponent(slug)}/version`);
      if (r.version === version) return;
      const fresh = await getTournament(slug);
      if (!fresh || STATE.tournament?.slug !== slug) return;
      version = fresh.version;
      onUpdate(fresh);
    } catch {}
  };
  STATE.realtimeChannel = setInterval(verifier, 5000);
  // Au retour sur l'appli, on vérifie tout de suite
  STATE.realtimeRetour = verifier;
  document.addEventListener('visibilitychange', verifier);
}

function cleanupRealtime() {
  if (STATE.realtimeChannel) {
    clearInterval(STATE.realtimeChannel);
    STATE.realtimeChannel = null;
  }
  if (STATE.realtimeRetour) {
    document.removeEventListener('visibilitychange', STATE.realtimeRetour);
    STATE.realtimeRetour = null;
  }
}

function renderSaveIndicator() {
  const el = $('#save-indicator');
  if (!el) return;
  el.textContent = STATE.savePending ? 'Enregistrement…' : 'À jour';
  el.style.color = STATE.savePending ? 'var(--accent)' : 'var(--success)';
}

// ============== TOP BAR ==============

function topbar({ showUser = true } = {}) {
  const u = STATE.user;
  return `
    <div class="topbar">
      <a class="logo" href="#/">
        <span class="logo-mark"></span>
        <span class="logo-text">LeCochonnet</span>
      </a>
      <div class="topbar-right">
        ${showUser && u ? `
          <span class="user">${escapeHtml(nomAffiche())}</span>
          ${estAdmin() ? '<a href="#/comptes" class="btn ghost">Comptes</a>' : ''}
          <a href="#/mot-de-passe" class="btn ghost" title="Changer mon mot de passe">🔑</a>
          <button class="ghost" id="btn-logout">Déconnexion</button>
        ` : showUser && !u ? `
          <a href="#/login" class="btn ghost">Connexion organisateur</a>
        ` : ''}
      </div>
    </div>
  `;
}

function bindTopbar() {
  const lo = $('#btn-logout');
  if (lo) lo.addEventListener('click', signOut);
}

// ============== HOME ==============

async function renderHome() {
  if (!STATE.user) {
    app.innerHTML = `
      ${topbar()}
      <div style="text-align: center; padding: 40px 16px;">
        <h1 style="font-size: 36px; margin-bottom: 12px;">LeCochonnet</h1>
        <p class="muted" style="font-size: 17px; max-width: 460px; margin: 0 auto 32px;">
          Organise tes tournois de pétanque, partage le tableau en direct avec les joueurs et le public.
        </p>
        <div class="row" style="justify-content: center; gap: 10px; flex-wrap: wrap;">
          <a href="#/login" class="btn primary">Connexion organisateur</a>
          <a href="#/compteur" class="btn">🎯 Compteur de points</a>
          <a href="#/duel" class="btn">🎲 Duel</a>
          <a href="#/mesure" class="btn">📏 Mesure photo</a>
        </div>
        <p class="tiny muted mt-3">Le public n'a pas besoin de compte — un QR code suffit.</p>
      </div>
    `;
    bindTopbar();
    return;
  }
  let tournaments = [];
  try { tournaments = await listMyTournaments(); }
  catch (e) { toast('Erreur de chargement'); }

  app.innerHTML = `
    ${topbar()}
    <div class="row mb-2" style="justify-content: space-between; flex-wrap: wrap; gap: 8px;">
      <h1>${estAdmin() ? 'Tous les tournois' : 'Mes tournois'}</h1>
      <div class="row tight">
        <a href="#/compteur" class="btn">🎯 Compteur</a>
        <a href="#/duel" class="btn">🎲 Duel</a>
        <a href="#/mesure" class="btn">📏 Mesure</a>
        <button class="primary" id="btn-create">+ Nouveau tournoi</button>
      </div>
    </div>
    <div id="tournament-list">
      ${tournaments.length === 0
        ? '<div class="empty">Aucun tournoi pour le moment. Crée ton premier !</div>'
        : tournaments.map(t => `
          <div class="tournament-list-item" data-slug="${escapeHtml(t.slug)}">
            <div>
              <h3>${escapeHtml(t.name)}</h3>
              <div class="meta">
                ${new Date(t.created_at).toLocaleDateString('fr-FR')}
                · ${(t.state?.teams?.length || 0)} équipes
                · <span class="badge ${tournamentStatusBadge(t)}">${tournamentStatusLabel(t)}</span>
                ${estAdmin() && t.organizer_id !== STATE.user.id ? `· par ${escapeHtml(t.organizer_name || 'compte supprimé')}` : ''}
              </div>
            </div>
            <div class="row tight">
              <a class="btn ghost" href="#/t/${escapeHtml(t.slug)}" onclick="event.stopPropagation()">Vue publique</a>
              <button class="btn" data-open="${escapeHtml(t.slug)}">Ouvrir</button>
              <button class="btn ghost danger icon" data-delete="${escapeHtml(t.slug)}" data-name="${escapeHtml(t.name)}" title="Supprimer ce tournoi" aria-label="Supprimer">🗑</button>
            </div>
          </div>
        `).join('')
      }
    </div>

    <div class="mt-3" id="plans-library-section">
      <div class="row mb-2" style="justify-content: space-between; flex-wrap: wrap; gap: 8px;">
        <h2 style="font-size: 20px; margin: 0;">📍 Mes plans de terrains</h2>
        <button class="btn ghost" id="btn-add-lib-plan">+ Ajouter un plan</button>
      </div>
      <p class="tiny muted mb-2">Enregistre ici les plans que tu réutilises (ils restent sur cet appareil). Tu pourras les sélectionner directement dans l'onglet Plan d'un tournoi.</p>
      <div id="plans-library">${renderPlansLibraryGrid()}</div>
    </div>
  `;
  bindTopbar();
  $('#btn-create').addEventListener('click', showCreateModal);
  bindPlansLibrarySection();
  $$('#tournament-list [data-open]').forEach(b => {
    b.addEventListener('click', e => navigate('#/admin/' + e.target.dataset.open));
  });
  $$('#tournament-list [data-delete]').forEach(b => {
    b.addEventListener('click', async e => {
      e.stopPropagation();
      const slug = e.currentTarget.dataset.delete;
      const name = e.currentTarget.dataset.name;
      if (!confirm(`Supprimer définitivement le tournoi "${name}" ?\n\nCette action est irréversible.`)) return;
      try {
        await deleteTournamentBySlug(slug);
        toast('Tournoi supprimé');
        renderHome();
      } catch (err) {
        toast('Erreur : ' + (err.message || 'suppression échouée'));
      }
    });
  });
  $$('#tournament-list .tournament-list-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return;
      navigate('#/admin/' + el.dataset.slug);
    });
  });
}

// Grille des plans enregistrés (page d'accueil)
function renderPlansLibraryGrid() {
  const lib = getPlansLibrary();
  if (lib.length === 0) {
    return '<div class="empty">Aucun plan enregistré. Ajoute-en un pour le réutiliser dans tes tournois.</div>';
  }
  return `
    <div class="plans-picker-grid">
      ${lib.map(p => `
        <div class="plan-thumb">
          <img src="${escapeHtml(p.dataUrl)}" alt="${escapeHtml(p.name)}" data-zoom="${p.id}" />
          <span>${escapeHtml(p.name)}</span>
          <button class="ghost tiny danger" data-del-plan="${p.id}" aria-label="Supprimer">🗑 Supprimer</button>
        </div>
      `).join('')}
    </div>
  `;
}

function bindPlansLibrarySection() {
  const refresh = () => {
    const grid = $('#plans-library');
    if (grid) { grid.innerHTML = renderPlansLibraryGrid(); bindPlansLibrarySection(); }
  };
  // Ajouter un plan à la bibliothèque (upload + nom)
  $('#btn-add-lib-plan')?.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.style.display = 'none';
    inp.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { toast('Image trop lourde (max 10 Mo)'); return; }
      try {
        toast('Compression en cours…');
        const compressed = await compressImage(file, 1600, 0.8);
        const defname = (file.name || 'Plan').replace(/\.[^.]+$/, '');
        const name = prompt('Nom du plan :', defname);
        if (name === null) return;
        if (savePlanToLibrary(name.trim() || 'Plan', compressed)) {
          toast('Plan ajouté');
          refresh();
        }
      } catch (err) {
        console.error(err);
        toast("Erreur : impossible de charger l'image");
      }
    });
    document.body.appendChild(inp);
    inp.click();
    setTimeout(() => inp.remove(), 1000);
  });
  // Supprimer un plan
  $$('#plans-library [data-del-plan]').forEach(b => {
    b.addEventListener('click', () => {
      const lib = getPlansLibrary();
      const p = lib.find(x => x.id === b.dataset.delPlan);
      if (!p) return;
      if (!confirm(`Supprimer le plan "${p.name}" de ta bibliothèque ?`)) return;
      deletePlanFromLibrary(b.dataset.delPlan);
      toast('Plan supprimé');
      refresh();
    });
  });
  // Agrandir un plan au clic
  $$('#plans-library [data-zoom]').forEach(img => {
    img.addEventListener('click', () => openImageFullscreen(img.src));
  });
}

function tournamentStatusLabel(t) {
  const s = t.state || {};
  if (s.brPrincipal && s.brPrincipal.length > 0) {
    const finale = s.brPrincipal[s.brPrincipal.length - 1][0];
    if (isMatchDecided(finale)) return 'Terminé';
    return 'Finales';
  }
  if (s.poules && s.poules.length > 0) return 'Poules';
  if (s.teams && s.teams.length > 0) return 'Inscription';
  return 'Nouveau';
}
function tournamentStatusBadge(t) {
  return tournamentStatusLabel(t) === 'Terminé' ? '' : 'live';
}

function showCreateModal() {
  const wrap = document.createElement('div');
  wrap.className = 'modal-bg';
  wrap.innerHTML = `
    <div class="modal">
      <h2>Nouveau tournoi</h2>
      <p class="muted tiny">Donne-lui un nom (ex: "14 juillet 2026 — Aunay")</p>
      <input type="text" id="modal-name" placeholder="Nom du tournoi" class="mt-2" />
      <div class="modal-actions">
        <button class="ghost" id="modal-cancel">Annuler</button>
        <button class="primary" id="modal-ok">Créer</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const input = $('#modal-name');
  input.focus();
  const close = () => wrap.remove();
  $('#modal-cancel').addEventListener('click', close);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  const submit = async () => {
    const name = input.value.trim();
    if (!name) return;
    try {
      const t = await createTournament(name);
      close();
      navigate('#/admin/' + t.slug);
    } catch (e) { toast('Erreur : ' + (e.message || 'création')); }
  };
  $('#modal-ok').addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

// ============== AUTH VIEWS ==============

function renderLogin() {
  app.innerHTML = `
    ${topbar({ showUser: false })}
    <div class="auth-container">
      <h2 style="margin-bottom: 4px;">Connexion organisateur</h2>
      <p class="muted tiny mb-2">Pour créer et gérer des tournois.</p>
      <label class="field"><span class="label-text">Identifiant (ou e-mail)</span><input type="text" id="login-email" autocapitalize="none" autocomplete="username" spellcheck="false" /></label>
      <label class="field"><span class="label-text">Mot de passe</span><input type="password" id="login-password" /></label>
      <button class="primary" id="btn-login" style="width: 100%; justify-content: center;">Se connecter</button>
      <p class="tiny center mt-2 muted">Pas de compte ? Demandez-le à un administrateur.</p>
    </div>
  `;
  bindTopbar();
  const doLogin = async () => {
    try { await signIn($('#login-email').value, $('#login-password').value); navigate('#/'); }
    catch (e) { toast(e.message || 'Échec'); }
  };
  $('#btn-login').addEventListener('click', doLogin);
  $('#login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}


// ============== COMPTEUR DE POINTS ==============

const COMPTEUR_STORAGE_KEY = 'lecochonnet_compteur_v1';

function loadCompteurState() {
  try {
    const raw = localStorage.getItem(COMPTEUR_STORAGE_KEY);
    if (!raw) return defaultCompteurState();
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.equipes) return defaultCompteurState();
    return parsed;
  } catch {
    return defaultCompteurState();
  }
}

function saveCompteurState(state) {
  try { localStorage.setItem(COMPTEUR_STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function defaultCompteurState() {
  return {
    equipes: [
      { name: 'Équipe A' },
      { name: 'Équipe B' }
    ],
    menes: [], // [{ a: 2, b: 0 }, { a: 0, b: 3 }, ...]
    scoreLimit: 13 // utilisé pour détecter le vainqueur
  };
}

function compteurTotals(state) {
  let a = 0, b = 0;
  state.menes.forEach(m => { a += (m.a || 0); b += (m.b || 0); });
  return { a, b };
}

function compteurWinner(state) {
  const { a, b } = compteurTotals(state);
  if (a >= state.scoreLimit && a > b) return 0;
  if (b >= state.scoreLimit && b > a) return 1;
  return null;
}

function renderCompteur() {
  // Vue dédiée (page entière) : utilisée depuis la home (#/compteur)
  app.innerHTML = `
    ${topbar({ showUser: false })}
    <div class="row mb-2" style="justify-content: space-between; align-items: center;">
      <h1>🎯 Compteur de points</h1>
      <a class="btn ghost" href="#/">← Accueil</a>
    </div>
    <p class="muted tiny mb-2">Compteur indépendant pour une partie. Mène par mène, total automatique.</p>
    <div id="compteur-container"></div>
  `;
  bindTopbar();
  renderCompteurInTab($('#compteur-container'));
}

// Rendu du compteur dans un container donné (utilisable dans un onglet de tournoi aussi)
function renderCompteurInTab(container) {
  const state = STATE.compteur || (STATE.compteur = loadCompteurState());
  const { a, b } = compteurTotals(state);
  const winnerIdx = compteurWinner(state);
  const nextMene = state.menes.length + 1;
  const isFinished = winnerIdx !== null;

  container.innerHTML = `
    <div class="card compteur-card">
      <div class="vs-stack">
        <div class="vs-team ${winnerIdx === 0 ? 'gagnant' : ''}">
          <input type="text" class="compteur-name" data-eq="0" value="${escapeHtml(state.equipes[0].name)}" />
          <div class="compteur-score">${a}</div>
          ${winnerIdx === 0 ? '<div class="compteur-trophy">🏆 Gagne !</div>' : ''}
        </div>
        <div class="vs-divider"><span>VS</span></div>
        <div class="vs-team ${winnerIdx === 1 ? 'gagnant' : ''}">
          <input type="text" class="compteur-name" data-eq="1" value="${escapeHtml(state.equipes[1].name)}" />
          <div class="compteur-score">${b}</div>
          ${winnerIdx === 1 ? '<div class="compteur-trophy">🏆 Gagne !</div>' : ''}
        </div>
      </div>
    </div>

    <div class="card">
      <h3 class="mb-2">${isFinished ? 'Partie terminée' : `Mène ${nextMene}`}</h3>
      ${isFinished ? `
        <p class="muted">${escapeHtml(state.equipes[winnerIdx].name)} a atteint ${state.scoreLimit} points.</p>
      ` : `
        <p class="muted tiny mb-2">Combien de points marqués sur cette mène ?</p>
        <div class="mene-block">
          <div class="mene-team-label">${escapeHtml(state.equipes[0].name)}</div>
          <div class="opt-grid opt-grid-7" data-mene-side="A">
            ${[0, 1, 2, 3, 4, 5, 6].map(v => `
              <label data-val="${v}" class="${state.tempMeneA === v ? 'selected' : ''}">${v}</label>
            `).join('')}
          </div>
        </div>
        <div class="mene-separator"></div>
        <div class="mene-block">
          <div class="mene-team-label">${escapeHtml(state.equipes[1].name)}</div>
          <div class="opt-grid opt-grid-7" data-mene-side="B">
            ${[0, 1, 2, 3, 4, 5, 6].map(v => `
              <label data-val="${v}" class="${state.tempMeneB === v ? 'selected' : ''}">${v}</label>
            `).join('')}
          </div>
        </div>
        <p class="tiny muted mt-2">Une seule équipe peut marquer par mène (0 pour l'autre).</p>
        <button class="primary mt-2" id="btn-add-mene" style="width: 100%; justify-content: center;"
          ${state.tempMeneA == null && state.tempMeneB == null ? 'disabled' : ''}>
          Valider la mène ${nextMene}
        </button>
      `}
    </div>

    ${state.menes.length > 0 ? `
      <div class="card">
        <div class="row mb-2" style="justify-content: space-between; align-items: center;">
          <h3 style="margin: 0;">Historique</h3>
          <button class="ghost tiny" id="btn-undo-mene">↶ Annuler dernière</button>
        </div>
        <table class="compteur-historique">
          <thead>
            <tr><th>Mène</th><th>${escapeHtml(state.equipes[0].name)}</th><th>${escapeHtml(state.equipes[1].name)}</th><th>Total</th></tr>
          </thead>
          <tbody>
            ${state.menes.map((m, i) => {
              const cumA = state.menes.slice(0, i + 1).reduce((s, mm) => s + (mm.a || 0), 0);
              const cumB = state.menes.slice(0, i + 1).reduce((s, mm) => s + (mm.b || 0), 0);
              return `
                <tr>
                  <td>${i + 1}</td>
                  <td>${m.a > 0 ? `+${m.a}` : '—'}</td>
                  <td>${m.b > 0 ? `+${m.b}` : '—'}</td>
                  <td><strong>${cumA} - ${cumB}</strong></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    ` : ''}

    <div class="row mt-3" style="justify-content: center;">
      <button class="ghost danger" id="btn-reset-compteur">Nouvelle partie</button>
    </div>
  `;

  bindCompteurEvents(container);
}

function bindCompteurEvents(scope) {
  const root = scope || document;
  const state = STATE.compteur;

  // Changement nom des équipes
  Array.from(root.querySelectorAll('.compteur-name')).forEach(inp => {
    inp.addEventListener('input', e => {
      const idx = parseInt(e.target.dataset.eq);
      state.equipes[idx].name = e.target.value || `Équipe ${idx === 0 ? 'A' : 'B'}`;
      saveCompteurState(state);
    });
    inp.addEventListener('blur', () => refreshCompteur());
  });

  // Sélection des points pour la mène en cours
  Array.from(root.querySelectorAll('[data-mene-side]')).forEach(group => {
    group.addEventListener('click', e => {
      const opt = e.target.closest('[data-val]');
      if (!opt) return;
      const v = parseInt(opt.dataset.val);
      const side = group.dataset.meneSide;
      if (side === 'A') {
        state.tempMeneA = v;
        if (v > 0) state.tempMeneB = 0;
      } else {
        state.tempMeneB = v;
        if (v > 0) state.tempMeneA = 0;
      }
      refreshCompteur();
    });
  });

  // Valider la mène
  const addBtn = root.querySelector('#btn-add-mene');
  if (addBtn) addBtn.addEventListener('click', () => {
    const a = state.tempMeneA || 0;
    const b = state.tempMeneB || 0;
    if (a === 0 && b === 0) { toast('Aucun point saisi'); return; }
    state.menes.push({ a, b });
    state.tempMeneA = null;
    state.tempMeneB = null;
    saveCompteurState(state);
    refreshCompteur();
  });

  // Annuler dernière mène
  const undoBtn = root.querySelector('#btn-undo-mene');
  if (undoBtn) undoBtn.addEventListener('click', () => {
    if (state.menes.length === 0) return;
    state.menes.pop();
    saveCompteurState(state);
    refreshCompteur();
  });

  // Reset
  const resetBtn = root.querySelector('#btn-reset-compteur');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    if (state.menes.length > 0 && !confirm('Effacer la partie en cours et repartir à zéro ?')) return;
    const nA = state.equipes[0].name;
    const nB = state.equipes[1].name;
    STATE.compteur = defaultCompteurState();
    STATE.compteur.equipes[0].name = nA;
    STATE.compteur.equipes[1].name = nB;
    saveCompteurState(STATE.compteur);
    refreshCompteur();
  });
}

// Rerendu intelligent : on rafraîchit dans le bon container selon le contexte
function refreshCompteur() {
  // Si on est dans la vue dédiée
  const dedicated = $('#compteur-container');
  if (dedicated) { renderCompteurInTab(dedicated); return; }
  // Sinon, on est dans un onglet de tournoi
  const tabContent = $('#tab-content');
  if (tabContent && STATE.activeTab === 'compteur') { renderCompteurInTab(tabContent); return; }
}

// ============== DUEL (match au meilleur des 3 manches) ==============

const DUEL_STORAGE_KEY = 'lecochonnet_duel_v1';

function loadDuelState() {
  try {
    const raw = localStorage.getItem(DUEL_STORAGE_KEY);
    if (!raw) return defaultDuelState();
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.equipes) return defaultDuelState();
    return parsed;
  } catch {
    return defaultDuelState();
  }
}

function saveDuelState(state) {
  try { localStorage.setItem(DUEL_STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function defaultDuelState() {
  return {
    equipes: [
      { name: 'Équipe A' },
      { name: 'Équipe B' }
    ],
    manches: [], // [{ a: 13, b: 7 }, { a: 8, b: 13 }, ...]
    targetWins: 2 // au meilleur des 3 manches : 2 victoires pour gagner
  };
}

function duelManchesWins(state) {
  let a = 0, b = 0;
  state.manches.forEach(m => {
    if (m.a > m.b) a++;
    else if (m.b > m.a) b++;
  });
  return { a, b };
}

function duelWinner(state) {
  const { a, b } = duelManchesWins(state);
  if (a >= state.targetWins) return 0;
  if (b >= state.targetWins) return 1;
  return null;
}

function renderDuel() {
  const state = STATE.duel || (STATE.duel = loadDuelState());
  const wins = duelManchesWins(state);
  const winnerIdx = duelWinner(state);
  const totalManches = state.manches.length;
  const nextManche = totalManches + 1;
  const isFinished = winnerIdx !== null;
  const isBelle = wins.a === 1 && wins.b === 1 && !isFinished;

  app.innerHTML = `
    ${topbar({ showUser: false })}
    <div class="row mb-2" style="justify-content: space-between; align-items: center;">
      <h1>🎲 Duel</h1>
      <a class="btn ghost" href="#/">← Accueil</a>
    </div>
    <p class="muted tiny mb-2">Match au meilleur des 3 manches. Premier à 2 victoires gagne.</p>

    <div class="card compteur-card">
      <div class="vs-stack">
        <div class="vs-team ${winnerIdx === 0 ? 'gagnant' : ''}">
          <input type="text" class="duel-name" data-eq="0" value="${escapeHtml(state.equipes[0].name)}" />
          <div class="duel-wins">
            ${[0, 1].map(w => `<span class="duel-win-dot ${wins.a > w ? 'on' : ''}"></span>`).join('')}
          </div>
          <div class="duel-wins-label">${wins.a} / ${state.targetWins} manche${wins.a > 1 ? 's' : ''}</div>
          ${winnerIdx === 0 ? '<div class="compteur-trophy">🏆 Gagne le match !</div>' : ''}
        </div>
        <div class="vs-divider">
          ${isBelle ? '<span class="duel-belle">LA BELLE</span>' : '<span>VS</span>'}
        </div>
        <div class="vs-team ${winnerIdx === 1 ? 'gagnant' : ''}">
          <input type="text" class="duel-name" data-eq="1" value="${escapeHtml(state.equipes[1].name)}" />
          <div class="duel-wins">
            ${[0, 1].map(w => `<span class="duel-win-dot ${wins.b > w ? 'on' : ''}"></span>`).join('')}
          </div>
          <div class="duel-wins-label">${wins.b} / ${state.targetWins} manche${wins.b > 1 ? 's' : ''}</div>
          ${winnerIdx === 1 ? '<div class="compteur-trophy">🏆 Gagne le match !</div>' : ''}
        </div>
      </div>
    </div>

    ${isFinished ? `
      <div class="card">
        <h3 class="mb-2">Match terminé</h3>
        <p class="muted">${escapeHtml(state.equipes[winnerIdx].name)} remporte le duel ${winnerIdx === 0 ? wins.a + ' à ' + wins.b : wins.b + ' à ' + wins.a}.</p>
      </div>
    ` : `
      <div class="card">
        <h3 class="mb-2">${isBelle ? 'Manche décisive (la belle)' : `Manche ${nextManche}`}</h3>
        <p class="muted tiny mb-2">Saisissez le score final de cette manche.</p>
        <div class="mene-block">
          <div class="mene-team-label">${escapeHtml(state.equipes[0].name)}</div>
          <input type="number" min="0" max="13" inputmode="numeric"
                 id="duel-score-a" value="${state.tempA ?? ''}" class="duel-score-input" placeholder="—" />
        </div>
        <div class="mene-separator"></div>
        <div class="mene-block">
          <div class="mene-team-label">${escapeHtml(state.equipes[1].name)}</div>
          <input type="number" min="0" max="13" inputmode="numeric"
                 id="duel-score-b" value="${state.tempB ?? ''}" class="duel-score-input" placeholder="—" />
        </div>
        <button class="primary mt-2" id="btn-add-manche" style="width: 100%; justify-content: center;">
          Valider la manche ${nextManche}
        </button>
      </div>
    `}

    ${state.manches.length > 0 ? `
      <div class="card">
        <div class="row mb-2" style="justify-content: space-between; align-items: center;">
          <h3 style="margin: 0;">Historique</h3>
          <button class="ghost tiny" id="btn-undo-manche">↶ Annuler dernière</button>
        </div>
        <table class="compteur-historique">
          <thead>
            <tr><th>Manche</th><th>${escapeHtml(state.equipes[0].name)}</th><th>${escapeHtml(state.equipes[1].name)}</th><th>Vainqueur</th></tr>
          </thead>
          <tbody>
            ${state.manches.map((m, i) => {
              const v = m.a > m.b ? state.equipes[0].name : (m.b > m.a ? state.equipes[1].name : '—');
              return `
                <tr>
                  <td>${i + 1}</td>
                  <td>${m.a}</td>
                  <td>${m.b}</td>
                  <td>${escapeHtml(v)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    ` : ''}

    <div class="row mt-3" style="justify-content: center;">
      <button class="ghost danger" id="btn-reset-duel">Nouveau duel</button>
    </div>
  `;

  bindTopbar();
  bindDuelEvents();
}

function bindDuelEvents() {
  const state = STATE.duel;

  // Changement nom des équipes
  $$('.duel-name').forEach(inp => {
    inp.addEventListener('input', e => {
      const idx = parseInt(e.target.dataset.eq);
      state.equipes[idx].name = e.target.value || `Équipe ${idx === 0 ? 'A' : 'B'}`;
      saveDuelState(state);
    });
    inp.addEventListener('blur', () => renderDuel());
  });

  // Saisie des scores
  ['duel-score-a', 'duel-score-b'].forEach(id => {
    const inp = $('#' + id);
    if (!inp) return;
    inp.addEventListener('input', e => {
      const v = e.target.value === '' ? null : Math.max(0, Math.min(13, parseInt(e.target.value)));
      if (id === 'duel-score-a') state.tempA = v;
      else state.tempB = v;
      saveDuelState(state);
    });
  });

  // Valider la manche
  $('#btn-add-manche')?.addEventListener('click', () => {
    const a = state.tempA;
    const b = state.tempB;
    if (a == null || b == null) {
      toast('Saisis les deux scores');
      return;
    }
    if (a === b) {
      toast('Une manche ne peut pas être nulle en pétanque');
      return;
    }
    state.manches.push({ a, b });
    state.tempA = null;
    state.tempB = null;
    saveDuelState(state);
    renderDuel();
  });

  // Annuler dernière manche
  $('#btn-undo-manche')?.addEventListener('click', () => {
    if (state.manches.length === 0) return;
    state.manches.pop();
    saveDuelState(state);
    renderDuel();
  });

  // Nouveau duel
  $('#btn-reset-duel')?.addEventListener('click', () => {
    if (state.manches.length > 0 && !confirm('Effacer le duel en cours et repartir à zéro ?')) return;
    const nA = state.equipes[0].name;
    const nB = state.equipes[1].name;
    STATE.duel = defaultDuelState();
    STATE.duel.equipes[0].name = nA;
    STATE.duel.equipes[1].name = nB;
    saveDuelState(STATE.duel);
    renderDuel();
  });
}

// ============== ADMIN VIEW ==============

async function loadAndRenderAdmin(slug) {
  app.innerHTML = `${topbar()}<div class="empty" style="margin-top: 40px;">Chargement…</div>`;
  bindTopbar();
  try {
    const t = await getTournament(slug);
    if (!t) { app.innerHTML = `${topbar()}<div class="empty">Tournoi introuvable.</div>`; bindTopbar(); return; }
    if (!t.peutModifier) {
      app.innerHTML = `${topbar()}<div class="empty">Ce tournoi ne t'appartient pas.</div>`;
      bindTopbar(); return;
    }
    if (!t.state || !t.state.step) t.state = defaultState();
    migrateState(t.state);
    STATE.tournament = t;
    STATE.mode = 'admin';
    STATE.activeTab = 'tournoi';
    renderAdmin();
  } catch (e) { toast('Erreur : ' + e.message); }
}

// Migration : ajoute les champs manquants pour les anciens tournois
function migrateState(s) {
  if (!s.config) s.config = {};
  if (s.config.nbTerrains == null) s.config.nbTerrains = 4;
  if (s.config.heureDebut == null) s.config.heureDebut = '14:00';
  if (s.config.pauseEntreMatchs == null) s.config.pauseEntreMatchs = 5;
  if (s.config.pouleMode == null) s.config.pouleMode = 'size';
  if (s.config.nbPoules == null) s.config.nbPoules = 4;
  if (s.planning === undefined) s.planning = null;
  if (s.planTerrains === undefined) s.planTerrains = null;
  if (s.petiteFinalePrincipal === undefined) s.petiteFinalePrincipal = null;
  if (s.petiteFinaleConso === undefined) s.petiteFinaleConso = null;
  if (s.poulesVerrouillees === undefined) s.poulesVerrouillees = false;
  if (s.config.dureeMatchOverride === undefined) s.config.dureeMatchOverride = null;
  if (s.config.heureFinales === undefined) s.config.heureFinales = null;
  if (s.repechees === undefined) s.repechees = [];
  if (s.config.qualifMode === undefined) s.config.qualifMode = 'parPoule';
  if (s.config.tableauSize === undefined) s.config.tableauSize = 8;
}

// Remplace partout l'ancien nom d'une équipe par le nouveau (poules, brackets, petites finales)
function renameTeamEverywhere(s, oldName, newName) {
  if (!oldName || oldName === newName) return;
  // Poules : liste des équipes + matchs
  if (Array.isArray(s.poules)) {
    s.poules.forEach(p => {
      if (Array.isArray(p.teams)) {
        p.teams = p.teams.map(t => t === oldName ? newName : t);
      }
      if (Array.isArray(p.matches)) {
        p.matches.forEach(m => {
          if (m.a === oldName) m.a = newName;
          if (m.b === oldName) m.b = newName;
        });
      }
    });
  }
  // Brackets principal + consolante
  [s.brPrincipal, s.brConso].forEach(br => {
    if (!Array.isArray(br)) return;
    br.forEach(round => round.forEach(m => {
      if (m.a === oldName) m.a = newName;
      if (m.b === oldName) m.b = newName;
    }));
  });
  // Petites finales
  [s.petiteFinalePrincipal, s.petiteFinaleConso].forEach(pf => {
    if (!pf) return;
    if (pf.a === oldName) pf.a = newName;
    if (pf.b === oldName) pf.b = newName;
  });
}

function renderAdmin() {
  const t = STATE.tournament;
  const s = t.state;
  app.innerHTML = `
    ${topbar()}
    <div class="row mb-2" style="justify-content: space-between;">
      <div>
        <h1 style="display: inline-flex; align-items: center; gap: 8px;">
          <span id="tournament-name-display">${escapeHtml(t.name)}</span>
          <button class="ghost icon" id="btn-edit-name" title="Modifier le nom du tournoi" style="font-size: 16px;">✏️</button>
        </h1>
        <div class="tiny muted">URL publique : <code class="qr-url">${publicUrl(t.slug)}</code></div>
      </div>
      <div class="row tight">
        <span class="tiny" id="save-indicator" style="color: var(--success);">À jour</span>
        <button class="ghost" id="btn-share">QR / Partage</button>
        <button class="ghost danger" id="btn-delete-tournament">Supprimer</button>
        <a class="btn ghost" href="#/">← Mes tournois</a>
      </div>
    </div>
    ${mainTabs()}
    <div id="tab-content"></div>
  `;
  bindTopbar();
  $('#btn-edit-name')?.addEventListener('click', () => {
    const h1 = $('#tournament-name-display');
    if (!h1) return;
    const current = t.name;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = current;
    input.className = 'tournament-name-edit';
    h1.replaceWith(input);
    input.focus();
    input.select();
    $('#btn-edit-name').style.display = 'none';
    const commit = async () => {
      const nv = input.value.trim();
      if (nv && nv !== current) {
        try {
          await renameTournament(t.id, nv);
          t.name = nv;
          toast('Nom du tournoi modifié');
        } catch (e) {
          toast('Erreur : impossible de renommer');
        }
      }
      loadAndRenderAdmin(t.slug);
    };
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      if (ev.key === 'Escape') loadAndRenderAdmin(t.slug);
    });
    input.addEventListener('blur', commit);
  });
  $('#btn-share').addEventListener('click', showShareModal);
  $('#btn-delete-tournament').addEventListener('click', async () => {
    if (!confirm(`Supprimer définitivement le tournoi "${t.name}" ?\n\nCette action est irréversible.`)) return;
    try {
      await deleteTournamentBySlug(t.slug);
      toast('Tournoi supprimé');
      navigate('#/');
    } catch (err) {
      toast('Erreur : ' + (err.message || 'suppression échouée'));
    }
  });
  bindMainTabs();
  renderActiveTab();
}

function mainTabs() {
  const tabs = [
    { id: 'tournoi', label: 'Tournoi' },
    ...(STATE.mode === 'public' ? [{ id: 'equipe', label: '⭐ Mon équipe' }] : []),
    { id: 'plan', label: 'Plan' },
    { id: 'planning', label: 'Planning' },
    { id: 'reglement', label: 'Règlement' },
    { id: 'compteur', label: '🎯 Compteur' },
    { id: 'mesure', label: '📏 Mesure' }
  ];
  return `
    <div class="main-tabs">
      ${tabs.map(t => `
        <div class="main-tab ${STATE.activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.label}</div>
      `).join('')}
    </div>
  `;
}

function bindMainTabs() {
  $$('.main-tab').forEach(el => {
    el.addEventListener('click', () => {
      STATE.activeTab = el.dataset.tab;
      $$('.main-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === STATE.activeTab));
      renderActiveTab();
    });
  });
}

function renderActiveTab() {
  const c = $('#tab-content');
  if (STATE.mode === 'public') {
    if (STATE.activeTab === 'tournoi') renderPublicTournoi(c);
    else if (STATE.activeTab === 'equipe') renderMonEquipeTab(c);
    else if (STATE.activeTab === 'plan') renderPlanTab(c);
    else if (STATE.activeTab === 'planning') renderPlanningTab(c);
    else if (STATE.activeTab === 'reglement') renderReglementTab(c);
    else if (STATE.activeTab === 'compteur') renderCompteurInTab(c);
    else if (STATE.activeTab === 'mesure') renderMesureInTab(c);
    return;
  }
  if (STATE.activeTab === 'tournoi') renderTournoiTab(c);
  else if (STATE.activeTab === 'plan') renderPlanTab(c);
  else if (STATE.activeTab === 'planning') renderPlanningTab(c);
  else if (STATE.activeTab === 'reglement') renderReglementTab(c);
  else if (STATE.activeTab === 'compteur') renderCompteurInTab(c);
  else if (STATE.activeTab === 'mesure') renderMesureInTab(c);
}

function renderTournoiTab(container) {
  const s = STATE.tournament.state;
  container.innerHTML = `
    <div id="admin-stepper" class="stepper">
      ${stepperItem('teams', '1 · Équipes', s.step)}
      ${stepperItem('config', '2 · Format', s.step)}
      ${stepperItem('poules', '3 · Poules', s.step)}
      ${stepperItem('brackets', '4 · Finales', s.step)}
    </div>
    <div id="admin-content"></div>
  `;
  $$('#admin-stepper > div').forEach(el => {
    el.addEventListener('click', () => {
      const step = el.dataset.step;
      if (step === 'config' && s.teams.length < 6) return;
      if (step === 'poules' && s.poules.length === 0) return;
      if (step === 'brackets' && !s.brPrincipal) return;
      s.step = step;
      renderTournoiTab(container);
      scheduleSave();
    });
  });
  renderAdminContent();
}

function stepperItem(step, label, current) {
  const order = ['teams', 'config', 'poules', 'brackets'];
  const i = order.indexOf(step);
  const ci = order.indexOf(current);
  let cls = '';
  if (i < ci) cls = 'done';
  else if (i === ci) cls = 'current';
  return `<div class="${cls}" data-step="${step}" style="cursor: pointer;">${label}</div>`;
}

function renderAdminContent() {
  const s = STATE.tournament.state;
  const c = $('#admin-content');
  if (s.step === 'teams') c.innerHTML = renderStepTeams();
  else if (s.step === 'config') c.innerHTML = renderStepConfig();
  else if (s.step === 'poules') c.innerHTML = renderStepPoules();
  else if (s.step === 'brackets') c.innerHTML = renderStepBrackets();
  bindStepEvents();
}

// --- STEP TEAMS ---

function renderStepTeams() {
  const s = STATE.tournament.state;
  return `
    <div class="card">
      <h3 style="margin-bottom: 4px;">Inscription des équipes</h3>
      <p class="muted tiny mb-2">Tape un nom et appuie sur Entrée. Minimum 6 équipes pour faire des poules.</p>
      <div class="row mb-2">
        <input type="text" id="team-input" placeholder="Ex: Les Boulistes, ou Pompiers 1" autofocus />
        <button class="primary" id="team-add">Ajouter</button>
      </div>
      <div id="team-list">
        ${s.teams.length === 0
          ? '<div class="empty">Aucune équipe pour le moment.</div>'
          : s.teams.map((t, i) => `
            <div class="team">
              <span><span class="team-num">${i + 1}.</span><span class="team-name-text" data-name="${i}">${escapeHtml(t)}</span></span>
              <span class="row tight">
                <button class="ghost icon" data-edit="${i}" aria-label="Modifier" title="Modifier le nom">✏️</button>
                <button class="ghost icon" data-rm="${i}" aria-label="Supprimer" title="Supprimer">×</button>
              </span>
            </div>
          `).join('')
        }
      </div>
      <p class="tiny muted mt-2">${s.teams.length} équipe${s.teams.length > 1 ? 's' : ''}</p>
      <div class="row mt-3" style="justify-content: space-between;">
        <button class="ghost danger" id="team-clear">Tout effacer</button>
        <button class="primary" id="to-config" ${s.teams.length < 6 ? 'disabled' : ''}>Configurer →</button>
      </div>
    </div>
  `;
}

// --- STEP CONFIG ---

function renderStepConfig() {
  const s = STATE.tournament.state;
  const n = s.teams.length;
  return `
    <div class="card">
      <h3 class="mb-2">Format du tournoi</h3>

      <label class="field">
        <span class="label-text">Format des parties</span>
        <div class="opt-group" data-group="format">
          ${['temps10', 'temps15', 'temps20', 'temps25', 'temps30', 'points'].map(v => `
            <label data-val="${v}" class="${s.config.format === v ? 'selected' : ''}">
              ${formatLabel(v)}
            </label>
          `).join('')}
        </div>
        <p class="tiny muted mt-2">
          ${s.config.format === 'points'
            ? 'En 13 points : victoire = 3 pts, défaite = 0. Pas de nul.'
            : 'Au temps : victoire = 3 pts, nul = 1 pt, défaite = 0.'}
        </p>
      </label>

      <label class="field">
        <span class="label-text">Composition des poules</span>
        <div class="mode-switch" data-group="pouleMode">
          <label data-val="size" class="${s.config.pouleMode === 'size' ? 'selected' : ''}">Par taille de poule</label>
          <label data-val="count" class="${s.config.pouleMode === 'count' ? 'selected' : ''}">Par nombre de poules</label>
        </div>
      </label>

      <div id="poule-config-block">
        ${s.config.pouleMode === 'size' ? `
          <label class="field">
            <span class="label-text">Taille des poules</span>
            <div class="opt-grid opt-grid-8" data-group="pouleSize">
              ${[3, 4, 5, 6, 7, 8, 9, 10].map(v => `
                <label data-val="${v}" class="${s.config.pouleSize === v ? 'selected' : ''}">${v}</label>
              `).join('')}
            </div>
          </label>
        ` : `
          <label class="field">
            <span class="label-text">Nombre de poules</span>
            <div class="opt-grid opt-grid-8" data-group="nbPoules">
              ${Array.from({length: 16}, (_, i) => i + 2).map(v => `
                <label data-val="${v}" class="${s.config.nbPoules === v ? 'selected' : ''}">${v}</label>
              `).join('')}
            </div>
          </label>
        `}
        <p class="tiny ${isCompositionBalanced(n, s.config) === false ? 'warn' : 'muted'} mt-2" id="poule-info">${pouleDistribInfo(n, s.config)}</p>
        ${renderBalanceSuggestion(n, s.config)}
      </div>

      <label class="field">
        <span class="label-text">Qualification pour la phase finale</span>
        <div class="mode-switch" data-group="qualifMode">
          <label data-val="parPoule" class="${s.config.qualifMode !== 'tableau' ? 'selected' : ''}">Par poule</label>
          <label data-val="tableau" class="${s.config.qualifMode === 'tableau' ? 'selected' : ''}">Taille du tableau</label>
        </div>

        ${s.config.qualifMode === 'tableau' ? `
          <div class="mt-2">
            <span class="label-text">Nombre d'équipes en phase finale</span>
            <div class="opt-grid opt-grid-5" data-group="tableauSize">
              ${[2, 4, 8, 16, 32].map(v => {
                const dispo = v <= nextPowerOf2Down(n);
                return `<label data-val="${v}" class="${s.config.tableauSize === v ? 'selected' : ''} ${dispo ? '' : 'disabled'}" ${dispo ? '' : 'data-disabled="true"'}>${v}</label>`;
              }).join('')}
            </div>
            <p class="tiny muted mt-2">Les meilleures équipes sont qualifiées (1<sup>ers</sup> de poule en priorité, puis les meilleurs suivants). Les autres jouent la consolante.</p>
          </div>
        ` : `
          <div class="mt-2">
            <span class="label-text">Qualifiés par poule</span>
            <div class="opt-grid opt-grid-5" data-group="qualif">
              ${qualifOptions(n, s.config)}
            </div>
            <p class="tiny muted mt-2">Le tableau est complété à la puissance de 2 par repêchage. Les autres équipes jouent la consolante.</p>
          </div>
        `}
      </label>

      <label class="field">
        <span class="label-text">Nombre de terrains</span>
        <div class="opt-grid opt-grid-10" data-group="nbTerrains">
          ${Array.from({length: 20}, (_, i) => i + 1).map(v => `
            <label data-val="${v}" class="${s.config.nbTerrains === v ? 'selected' : ''}">${v}</label>
          `).join('')}
        </div>
      </label>

      <label class="field">
        <span class="label-text">Heure de début</span>
        <input type="time" id="heure-debut" value="${escapeHtml(s.config.heureDebut)}" style="max-width: 140px;" />
        <p class="tiny muted mt-2">L'app calculera l'horaire de chaque match en fonction.</p>
      </label>

      <label class="field">
        <span class="label-text">Pause entre deux matchs</span>
        <div class="opt-group" data-group="pauseEntreMatchs">
          ${[5, 10, 15].map(v => `
            <label data-val="${v}" class="${s.config.pauseEntreMatchs === v ? 'selected' : ''}">${v} min</label>
          `).join('')}
        </div>
        <p class="tiny muted mt-2">Temps pour transmettre les scores et lancer le match suivant.</p>
      </label>

      <div class="mt-3">
        ${renderTournamentPreview(s)}
      </div>

      <div class="row mt-3" style="justify-content: space-between;">
        <button class="ghost" id="back-teams">← Équipes</button>
        <button class="primary" id="gen-poules">Tirer les poules →</button>
      </div>
    </div>
  `;
}

// Détermine le nombre minimal d'équipes par poule selon la config
function minPouleSize(n, config) {
  if (n === 0) return 0;
  const sizes = computePouleSizes(n, config);
  return Math.min(...sizes);
}

// Génère les options Qualifiés disponibles selon la taille minimale des poules
function qualifOptions(n, config) {
  // Max qualifiés = taille de la plus petite poule - 1 (pour qu'au moins 1 équipe soit éliminée)
  const minSize = minPouleSize(n, config);
  const maxQualif = Math.max(1, minSize - 1);

  // S'assurer que la valeur actuelle est valide
  if (config.qualif > maxQualif) {
    config.qualif = maxQualif;
  }

  // Cases numériques de 1 à 10, grisées au-delà du max possible
  return Array.from({ length: 10 }, (_, i) => i + 1).map(v => {
    const disabled = v > maxQualif;
    return `<label data-val="${v}" class="${config.qualif === v ? 'selected' : ''} ${disabled ? 'disabled' : ''}" ${disabled ? 'data-disabled="true"' : ''}>${v}</label>`;
  }).join('');
}

// Affiche une suggestion d'équilibrage si la composition actuelle n'est pas équilibrée
function renderBalanceSuggestion(n, config) {
  if (n === 0) return '';
  if (isCompositionBalanced(n, config) !== false) return '';

  const suggestions = suggestBalancedPoulesCount(n);
  if (suggestions.length === 0) {
    return `<p class="tiny mt-2" style="color: var(--text-soft); font-style: italic;">Aucun découpage parfaitement équilibré possible avec ${n} équipes (pas un multiple usuel).</p>`;
  }

  const list = suggestions.map(sug =>
    `<button class="btn ghost tiny" data-suggest-p="${sug.p}">${sug.p} poules de ${sug.size}</button>`
  ).join(' ');

  return `
    <div class="balance-suggest">
      <span class="tiny muted">💡 Pour des poules toutes égales avec ${n} équipes :</span>
      <div class="row tight mt-2" style="flex-wrap: wrap;">${list}</div>
    </div>
  `;
}

function pouleDistribInfo(n, config) {
  if (n === 0) return 'Aucune équipe inscrite.';

  // Mode "par nombre de poules"
  if (config.pouleMode === 'count') {
    const p = config.nbPoules;
    if (n < p * 2) {
      return `⚠ ${n} équipes pour ${p} poules, c'est trop peu (il faut au moins 2 équipes par poule).`;
    }
    const baseSize = Math.floor(n / p);
    const extra = n % p;
    if (extra === 0) {
      const matchesPerPoule = baseSize * (baseSize - 1) / 2;
      return `✓ ${n} équipes → ${p} poules de ${baseSize} équipes — équilibré (${matchesPerPoule * p} matchs au total)`;
    }
    const bigPoules = extra;
    const smallPoules = p - extra;
    const bigSize = baseSize + 1;
    const totalMatches = bigPoules * (bigSize * (bigSize - 1) / 2) + smallPoules * (baseSize * (baseSize - 1) / 2);
    return `${n} équipes → ${bigPoules} poule${bigPoules > 1 ? 's' : ''} de ${bigSize} et ${smallPoules} poule${smallPoules > 1 ? 's' : ''} de ${baseSize} (${totalMatches} matchs au total)`;
  }

  // Mode "par taille de poule" — version générique
  const sizes = computePouleSizes(n, config);
  // Regrouper par taille
  const counts = {};
  sizes.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
  const distinctSizes = Object.keys(counts).map(Number).sort((a, b) => b - a);
  const totalMatches = sizes.reduce((sum, sz) => sum + sz * (sz - 1) / 2, 0);

  if (distinctSizes.length === 1) {
    const sz = distinctSizes[0];
    const c = counts[sz];
    return `✓ ${n} équipes → ${c} poule${c > 1 ? 's' : ''} de ${sz} équipes — équilibré (${totalMatches} matchs au total)`;
  }
  // Mixte : on liste chaque groupe
  const parts = distinctSizes.map(sz => {
    const c = counts[sz];
    return `${c} poule${c > 1 ? 's' : ''} de ${sz}`;
  });
  return `${n} équipes → ${parts.join(' et ')} (${totalMatches} matchs au total)`;
}

// Petit helper : la composition actuelle est-elle équilibrée (toutes les poules font la même taille) ?
function isCompositionBalanced(n, config) {
  if (n === 0) return null;
  const sizes = computePouleSizes(n, config);
  return sizes.every(s => s === sizes[0]);
}

// Suggère le nombre de poules qui donnerait des poules égales pour N équipes
function suggestBalancedPoulesCount(n) {
  const suggestions = [];
  for (let p = 2; p <= 16; p++) {
    if (n % p === 0) {
      const size = n / p;
      if (size >= 3 && size <= 10) {
        suggestions.push({ p, size });
      }
    }
  }
  return suggestions;
}

// --- STEP POULES ---

function renderStepPoules() {
  const s = STATE.tournament.state;
  const fmt = s.config.format;
  const allDone = s.poules.every(p => p.matches.every(m => isMatchDecided(m)));
  const hasScores = s.poules.some(p => p.matches.some(m => m.scoreA != null || m.scoreB != null));
  const locked = s.poulesVerrouillees;

  return `
    <div class="card">
      <div class="row mb-2" style="justify-content: space-between; flex-wrap: wrap; gap: 8px;">
        <div class="tiny">
          <strong>${s.teams.length}</strong> équipes · <strong>${s.poules.length}</strong> poules ·
          <strong>${formatLabel(fmt)}</strong> · <strong>${s.config.nbTerrains}</strong> terrains · début <strong>${escapeHtml(s.config.heureDebut)}</strong> · pause <strong>${s.config.pauseEntreMatchs} min</strong>
        </div>
        ${!locked ? `
          <div class="row tight">
            <button class="ghost tiny" id="back-config" ${hasScores ? 'data-locked="true"' : ''}>← Format</button>
            <button class="${hasScores ? 'danger' : 'ghost'} tiny" id="reshuffle">${hasScores ? '🔒 Re-tirer' : 'Re-tirer'}</button>
          </div>
        ` : ''}
      </div>

      ${locked ? `
        <div class="lock-banner">
          🔒 <strong>Poules validées et verrouillées.</strong> Les scores ne sont plus modifiables. La phase finale est active.
          <button class="ghost tiny" id="deverrouiller" style="margin-left: 8px;">Déverrouiller</button>
        </div>
      ` : hasScores ? '<p class="tiny muted mb-2">⚠ Des scores sont déjà saisis. Le tirage et le format sont verrouillés.</p>' : ''}

      <div class="poules-grid">
        ${s.poules.map((p, pi) => renderPouleCard(p, pi)).join('')}
      </div>

      <div class="mt-3">
        ${hasScores ? `<div class="center mb-2"><button class="btn ghost" id="print-poule-results">🖨 Imprimer les résultats des poules (1 feuille par poule)</button></div>` : ''}
        ${locked ? `
          <div class="row" style="justify-content: flex-end;">
            <button class="primary" id="go-brackets-direct">Voir la phase finale →</button>
          </div>
        ` : `
          <div class="validation-zone">
            ${allDone
              ? '<p class="tiny mb-2">✓ Tous les matchs de poule sont terminés.</p>'
              : '<p class="tiny muted mb-2">Termine tous les matchs de poule pour pouvoir valider.</p>'}
            <button class="primary" id="valider-poules" ${!allDone ? 'disabled' : ''} style="width: 100%; justify-content: center;">
              🔒 Valider les poules et lancer les finales
            </button>
            <p class="tiny muted mt-2 center">Une fois validées, les poules seront figées et la phase finale activée pour tout le monde.</p>
          </div>
        `}
      </div>
    </div>
  `;
}

function renderPouleCard(p, pi) {
  const s = STATE.tournament.state;
  const standings = computeStandings(p, s.config.format);
  return `
    <div class="poule-card">
      <div class="poule-title">
        Poule ${p.name}
        <small>${p.teams.length} équipes · ${p.matches.length} matchs</small>
      </div>
      ${p.matches.map((m, mi) => {
        const sched = findScheduleForPouleMatch(s, pi, mi);
        return `
        <div class="match">
          <div class="team-l" title="${escapeHtml(m.a)}">${escapeHtml(m.a)}</div>
          <div class="match-mid">
            ${STATE.mode === 'admin' && !s.poulesVerrouillees
              ? `<input type="number" min="0" max="${maxScore()}" inputmode="numeric" data-p="${pi}" data-m="${mi}" data-s="A" value="${m.scoreA ?? ''}" />
                 <span>·</span>
                 <input type="number" min="0" max="${maxScore()}" inputmode="numeric" data-p="${pi}" data-m="${mi}" data-s="B" value="${m.scoreB ?? ''}" />`
              : `<span>${m.scoreA ?? '–'}</span><span>·</span><span>${m.scoreB ?? '–'}</span>`
            }
          </div>
          <div class="team-r" title="${escapeHtml(m.b)}">${escapeHtml(m.b)}</div>
        </div>
        ${sched ? `<div class="match-sched">T${sched.terrain} · ${sched.time}</div>` : ''}
        `;
      }).join('')}
      <table class="rank">
        <thead><tr><th>#</th><th>Équipe</th><th>Pts</th><th>V</th><th>N</th><th>D</th><th>+/-</th></tr></thead>
        <tbody>
          ${standings.map((row, ri) => `
            <tr class="${ri < s.config.qualif ? 'qualif' : ''}">
              <td>${ri + 1}</td><td>${escapeHtml(row.team)}</td>
              <td><strong>${row.points}</strong></td>
              <td>${row.wins}</td><td>${row.draws}</td><td>${row.losses}</td>
              <td>${row.diff > 0 ? '+' : ''}${row.diff}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// --- STEP BRACKETS ---

function renderStepBrackets() {
  const s = STATE.tournament.state;
  if (!s.brPrincipal) {
    return `<div class="card"><div class="empty">Brackets pas encore générés.</div></div>`;
  }
  propagateBracket(s.brPrincipal);
  if (s.brConso) propagateBracket(s.brConso);
  if (s.petiteFinalePrincipal) propagatePetiteFinale(s.brPrincipal, s.petiteFinalePrincipal);
  if (s.petiteFinaleConso) propagatePetiteFinale(s.brConso, s.petiteFinaleConso);
  // Recalcule le planning des tours suivants au cas où
  recomputeBracketSchedule();

  const finalP = s.brPrincipal[s.brPrincipal.length - 1][0];
  const champ = isMatchDecided(finalP) ? getMatchWinner(finalP) : null;
  const finalC = s.brConso ? s.brConso[s.brConso.length - 1][0] : null;
  const champC = (finalC && isMatchDecided(finalC)) ? getMatchWinner(finalC) : null;

  return `
    ${champ ? `
      <div class="champion-box">
        <span class="trophy">🏆</span>
        <div>Vainqueur du tournoi</div>
        <div class="name">${escapeHtml(champ)}</div>
        ${champC ? `<div class="tiny mt-2" style="font-family: 'DM Sans', sans-serif;">Vainqueur consolante : <strong>${escapeHtml(champC)}</strong></div>` : ''}
      </div>
    ` : ''}
    <div class="card">
      <div class="bracket-tabs">
        <div class="bracket-tab ${STATE.activeBracket === 'principal' ? 'active' : ''}" data-tab="principal">Tableau principal</div>
        <div class="bracket-tab ${STATE.activeBracket === 'conso' ? 'active' : ''}" data-tab="conso">Consolante</div>
      </div>
      <div id="bracket-principal-pane" style="display: ${STATE.activeBracket === 'principal' ? 'block' : 'none'};">
        ${renderRepechesInfo()}
        ${renderBracket(s.brPrincipal, 'principal')}
        ${renderPetiteFinale(s.petiteFinalePrincipal, 'principal')}
      </div>
      <div id="bracket-conso-pane" style="display: ${STATE.activeBracket === 'conso' ? 'block' : 'none'};">
        ${s.brConso ? `
          ${renderBracket(s.brConso, 'conso')}
          ${renderPetiteFinale(s.petiteFinaleConso, 'conso')}
        ` : '<div class="empty">Pas assez d\'équipes pour une consolante.</div>'}
      </div>
      ${renderClassementGlobal()}
      <div class="row mt-3" style="justify-content: space-between;">
        <button class="ghost" id="back-poules-step">← Poules</button>
      </div>
    </div>
  `;
}

// Affiche la liste des équipes repêchées (meilleurs non-qualifiés complétant le tableau)
function renderRepechesInfo() {
  const s = STATE.tournament.state;
  if (!s.repechees || s.repechees.length === 0) return '';
  return `
    <div class="repeches-info">
      <strong>🎟️ ${s.repechees.length} équipe${s.repechees.length > 1 ? 's' : ''} repêchée${s.repechees.length > 1 ? 's' : ''}</strong>
      pour compléter le tableau : ${s.repechees.map(t => escapeHtml(t)).join(', ')}.
      <span class="tiny muted">(meilleurs non-qualifiés, à la différence de points)</span>
    </div>
  `;
}

// Affiche le match de petite finale (3e place)
function renderPetiteFinale(pf, key) {
  if (!pf) return '';
  const valide = pf.valide === true;
  const canInput = STATE.mode === 'admin' && pf.a !== null && pf.b !== null && !valide;
  const winner = getMatchWinner(pf);
  const decided = isMatchDecided(pf);
  const aClass = decided ? (winner === pf.a ? 'bracket-winner' : 'bracket-loser') : '';
  const bClass = decided ? (winner === pf.b ? 'bracket-winner' : 'bracket-loser') : '';
  const isAdmin = STATE.mode === 'admin';
  const realMatch = pf.a !== null && pf.b !== null;
  return `
    <div class="petite-finale">
      <div class="petite-finale-label">🥉 Petite finale — 3<sup>e</sup> place</div>
      <div class="bracket-match ${valide ? 'valide' : ''}" style="max-width: 280px;">
        <div class="bracket-team ${aClass}">
          <span>${pf.a === null ? 'Perdant demi 1' : escapeHtml(pf.a)}</span>
          ${canInput
            ? `<input type="number" min="0" max="${maxScore()}" inputmode="numeric" data-pf="${key}" data-s="A" value="${pf.scoreA ?? ''}" />`
            : `<span class="tiny">${pf.scoreA ?? ''}</span>`}
        </div>
        <div class="bracket-team ${bClass}">
          <span>${pf.b === null ? 'Perdant demi 2' : escapeHtml(pf.b)}</span>
          ${canInput
            ? `<input type="number" min="0" max="${maxScore()}" inputmode="numeric" data-pf="${key}" data-s="B" value="${pf.scoreB ?? ''}" />`
            : `<span class="tiny">${pf.scoreB ?? ''}</span>`}
        </div>
        ${isAdmin && realMatch ? `
          <div class="match-valider">
            ${valide
              ? `<span class="match-lock">🔒 validé</span><button class="ghost tiny" data-modif-pf="${key}">Modifier</button>`
              : `<button class="mini-valider" data-valide-pf="${key}" ${decided ? '' : 'disabled'}>Valider</button>`
            }
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// Affiche le classement final fusionné (principal puis consolante à la suite)
function renderClassementGlobal() {
  const s = STATE.tournament.state;
  const rankingP = computeRanking(s.brPrincipal, s.petiteFinalePrincipal);
  if (rankingP.length === 0) return '';

  // On n'affiche le classement que si la finale du principal est jouée
  const finaleP = s.brPrincipal[s.brPrincipal.length - 1][0];
  if (!isMatchDecided(finaleP)) return '';

  // Décalage pour la consolante = nombre d'équipes du tableau principal
  let nbPrincipal = 0;
  s.brPrincipal[0].forEach(m => {
    if (m.a !== null) nbPrincipal++;
    if (m.b !== null) nbPrincipal++;
  });

  let rows = rankingP.map(r => ({ ...r, groupe: 'principal' }));

  // Ajout de la consolante si elle existe et que sa finale est jouée
  if (s.brConso) {
    const finaleC = s.brConso[s.brConso.length - 1][0];
    if (isMatchDecided(finaleC)) {
      const rankingC = computeRanking(s.brConso, s.petiteFinaleConso);
      rankingC.forEach(r => {
        rows.push({
          rang: r.rang + nbPrincipal,
          equipe: r.equipe,
          exaequo: r.exaequo,
          groupe: 'conso'
        });
      });
    }
  }

  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  return `
    <div class="classement">
      <h4 class="classement-title">Classement général</h4>
      <table class="classement-table">
        <tbody>
          ${rows.map(r => `
            <tr class="${r.rang <= 3 ? 'podium' : ''} ${r.groupe === 'conso' ? 'conso-row' : ''}">
              <td class="classement-rang">${medals[r.rang] || (r.rang + (r.exaequo ? 'e ex æquo' : 'e'))}</td>
              <td class="classement-equipe">${escapeHtml(r.equipe)}</td>
              <td class="classement-tag">
                ${r.diff != null && r.rang > 4 ? `<span class="classement-diff">${r.diff > 0 ? '+' : ''}${r.diff}</span>` : ''}
                ${r.groupe === 'conso' ? 'consolante' : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="center mt-2"><button class="btn ghost" id="print-recap">🖨 Imprimer le récapitulatif (podium + classement)</button></div>
      <p class="tiny muted mt-2">Au-delà de la 4<sup>e</sup> place, les équipes éliminées au même tour sont départagées à la différence de points de leurs matchs de phase finale (indiquée à droite).</p>
    </div>
  `;
}

function renderBracket(bracket, key) {
  const s = STATE.tournament.state;
  const names = roundLabels(bracket.length);
  // Offsets pour une numérotation continue des matchs (M1, M2, … à travers les tours)
  const offsets = [];
  let acc = 0;
  bracket.forEach((round, ri) => { offsets[ri] = acc; acc += round.length; });
  return `<div class="bracket">${bracket.map((round, ri) => `
    <div class="bracket-col">
      <div class="bracket-round-label">${names[ri]}</div>
      <div class="bracket-col-body">
        ${round.map((m, mi) => `<div class="bracket-slot">${renderBracketMatch(m, key, ri, mi, offsets)}</div>`).join('')}
      </div>
    </div>
  `).join('')}</div>`;
}

function renderBracketMatch(m, key, ri, mi, offsets) {
  const s = STATE.tournament.state;
  const winner = getMatchWinner(m);
  const decided = isMatchDecided(m);
  const valide = m.valide === true;
  const aClass = decided ? (winner === m.a ? 'bracket-winner' : 'bracket-loser') : '';
  const bClass = decided ? (winner === m.b ? 'bracket-winner' : 'bracket-loser') : '';
  const canInput = STATE.mode === 'admin' && m.a !== null && m.b !== null && !valide;
  const sched = findScheduleForBracketMatch(s, key, ri, mi);
  const isAdmin = STATE.mode === 'admin';
  const realMatch = m.a !== null && m.b !== null;
  const num = offsets ? offsets[ri] + mi + 1 : null;
  // Provenance : pour les tours après le premier, une case vide indique de quel match vient l'équipe
  let provA = '—', provB = '—';
  if (offsets && ri > 0) {
    provA = 'Vainqueur M' + (offsets[ri - 1] + (2 * mi) + 1);
    provB = 'Vainqueur M' + (offsets[ri - 1] + (2 * mi + 1) + 1);
  }
  const aLabel = m.a === null ? `<span class="bracket-prov">${provA}</span>` : escapeHtml(m.a);
  const bLabel = m.b === null ? `<span class="bracket-prov">${provB}</span>` : escapeHtml(m.b);
  return `
    <div class="bracket-match ${valide ? 'valide' : ''}">
      ${num ? `<div class="bracket-num">Match ${num}</div>` : ''}
      <div class="bracket-team ${aClass}">
        <span>${aLabel}</span>
        ${canInput
          ? `<input type="number" min="0" max="${maxScore()}" inputmode="numeric" data-br="${key}" data-r="${ri}" data-m="${mi}" data-s="A" value="${m.scoreA ?? ''}" />`
          : `<span class="tiny">${m.scoreA ?? ''}</span>`}
      </div>
      <div class="bracket-team ${bClass}">
        <span>${bLabel}</span>
        ${canInput
          ? `<input type="number" min="0" max="${maxScore()}" inputmode="numeric" data-br="${key}" data-r="${ri}" data-m="${mi}" data-s="B" value="${m.scoreB ?? ''}" />`
          : `<span class="tiny">${m.scoreB ?? ''}</span>`}
      </div>
      ${sched ? `<div class="match-sched">T${sched.terrain} · ${sched.time}</div>` : ''}
      ${isAdmin && realMatch ? `
        <div class="match-valider">
          ${valide
            ? `<span class="match-lock">🔒 validé</span><button class="ghost tiny" data-modif-br="${key}" data-r="${ri}" data-m="${mi}">Modifier</button>`
            : `<button class="mini-valider" data-valide-br="${key}" data-r="${ri}" data-m="${mi}" ${decided ? '' : 'disabled'}>Valider</button>`
          }
        </div>
      ` : ''}
    </div>
  `;
}

function roundLabels(n) {
  const labels = ['Finale', 'Demi-finale', 'Quart de finale', '8e de finale', '16e de finale'];
  const result = [];
  for (let i = n - 1; i >= 0; i--) result.push(labels[i] || `Tour ${n - i}`);
  return result;
}

// ============== MESURE PHOTO (aide au départage) ==============

let mesureState = null;
let mesureResizeHandler = null;

function mesureBodyHtml() {
  return `
    <p class="muted tiny mb-2">Prends une photo des boules <strong>vue du dessus</strong>. Zoome pour regarder de près, et active la mesure pour estimer les distances au cochonnet.</p>

    <div class="mesure-toolbar">
      <button class="btn primary" id="mesure-load">📷 Prendre / choisir une photo</button>
    </div>

    <div class="mesure-canvas-wrap" id="mesure-wrap">
      <canvas id="mesure-canvas"></canvas>
      <div class="mesure-hint" id="mesure-hint">Charge une photo pour commencer.</div>
    </div>

    <div class="mesure-controls" id="mesure-controls" style="display:none;">
      <div class="row tight" style="flex-wrap:wrap; justify-content:center;">
        <button class="btn ghost" id="mesure-zoomout">－ Zoom</button>
        <button class="btn ghost" id="mesure-zoomin">＋ Zoom</button>
        <button class="btn ghost" id="mesure-fit">Ajuster</button>
        <button class="btn" id="mesure-measure">📏 Mesurer</button>
      </div>
      <div class="mesure-measure-panel" id="mesure-measure-panel" style="display:none;">
        <div class="row tight" style="align-items:center; justify-content:center; flex-wrap:wrap;">
          <span class="tiny">Diamètre du cochonnet :</span>
          <input type="number" id="mesure-diam" value="30" min="10" max="60" style="width:64px;" /> <span class="tiny">mm</span>
          <button class="btn ghost tiny" id="mesure-restart">↺ Tout recommencer</button>
        </div>
        <p class="mesure-pills-label tiny">Choisis le point à placer, puis touche la photo. Tu peux aussi glisser un point pour l'ajuster.</p>
        <div class="mesure-points" id="mesure-points">
          <button class="pt-pill pt-coch" data-pt="cal0">Cochonnet ①</button>
          <button class="pt-pill pt-coch" data-pt="cal1">Cochonnet ②</button>
          <button class="pt-pill pt-verte" data-pt="boule1">🟢 Boule verte</button>
          <button class="pt-pill pt-bleue" data-pt="boule2">🔵 Boule bleue</button>
        </div>
        <p class="mesure-step tiny" id="mesure-step"></p>
      </div>
    </div>

    <div class="mesure-result" id="mesure-result"></div>

    <input type="file" accept="image/*" capture="environment" id="mesure-file" style="display:none;" />

    <p class="tiny muted mt-3" style="line-height:1.5;">⚠️ Mesure <strong>approximative</strong> : la photo doit être prise bien à la verticale au-dessus des boules. En cas d'égalité serrée (quelques millimètres), seule une <strong>mesure au réglet</strong> fait foi.</p>
  `;
}

function renderMesure() {
  app.innerHTML = `
    ${topbar({ showUser: false })}
    <div class="row mb-2" style="justify-content: space-between; align-items: center;">
      <h1>📏 Mesure photo</h1>
      <a class="btn ghost" href="#/">← Accueil</a>
    </div>
    ${mesureBodyHtml()}
  `;
  bindTopbar();
  initMesure();
}

function renderMesureInTab(container) {
  container.innerHTML = mesureBodyHtml();
  initMesure();
}

function initMesure() {
  mesureState = {
    img: null, scale: 1, ox: 0, oy: 0,
    mode: 'loupe', active: null,
    cal: [], boule1: null, boule2: null,
    diam: 30,
    drag: null
  };

  const canvas = document.getElementById('mesure-canvas');
  const ctx = canvas.getContext('2d');
  const wrap = document.getElementById('mesure-wrap');
  const hint = document.getElementById('mesure-hint');

  function sizeCanvas() {
    const w = wrap.clientWidth;
    const h = Math.min(Math.round(window.innerHeight * 0.6), 640);
    canvas.width = w;
    canvas.height = h;
  }

  function fitImage() {
    if (!mesureState.img) return;
    const iw = mesureState.img.width, ih = mesureState.img.height;
    const s = Math.min(canvas.width / iw, canvas.height / ih);
    mesureState.scale = s;
    mesureState.ox = (canvas.width - iw * s) / 2;
    mesureState.oy = (canvas.height - ih * s) / 2;
  }

  function imgToScreen(p) {
    return { x: mesureState.ox + p.x * mesureState.scale, y: mesureState.oy + p.y * mesureState.scale };
  }
  function screenToImg(x, y) {
    return { x: (x - mesureState.ox) / mesureState.scale, y: (y - mesureState.oy) / mesureState.scale };
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!mesureState.img) return;
    ctx.drawImage(mesureState.img, mesureState.ox, mesureState.oy,
      mesureState.img.width * mesureState.scale, mesureState.img.height * mesureState.scale);

    // Calibration (diamètre cochonnet)
    if (mesureState.cal.length >= 1) {
      mesureState.cal.forEach(p => drawPoint(imgToScreen(p), '#e0a020'));
    }
    if (mesureState.cal.length === 2) {
      const a = imgToScreen(mesureState.cal[0]), b = imgToScreen(mesureState.cal[1]);
      drawLine(a, b, '#e0a020');
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      drawPoint(c, '#b94a2c', 6); // centre cochonnet
    }
    // Boules
    if (mesureState.cal.length === 2) {
      const a = imgToScreen(mesureState.cal[0]), b = imgToScreen(mesureState.cal[1]);
      const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (mesureState.boule1) {
        const p = imgToScreen(mesureState.boule1);
        drawLine(centre, p, '#2f7d4f'); drawPoint(p, '#2f7d4f');
      }
      if (mesureState.boule2) {
        const p = imgToScreen(mesureState.boule2);
        drawLine(centre, p, '#2f6cb9'); drawPoint(p, '#2f6cb9');
      }
    }
  }
  function drawPoint(p, color, r = 5) {
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
  }
  function drawLine(a, b, color) {
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  }

  function computeResult() {
    const res = document.getElementById('mesure-result');
    if (mesureState.cal.length < 2 || !mesureState.boule1 || !mesureState.boule2) { res.innerHTML = ''; return; }
    const calPx = dist(mesureState.cal[0], mesureState.cal[1]);
    if (calPx < 2) { res.innerHTML = '<div class="mesure-warn">Calibration invalide, recommence.</div>'; return; }
    const mmPerPx = mesureState.diam / calPx;
    const centre = { x: (mesureState.cal[0].x + mesureState.cal[1].x) / 2, y: (mesureState.cal[0].y + mesureState.cal[1].y) / 2 };
    const d1 = dist(centre, mesureState.boule1) * mmPerPx / 10; // cm
    const d2 = dist(centre, mesureState.boule2) * mmPerPx / 10;
    const ecart = Math.abs(d1 - d2);
    let verdict;
    if (ecart < 3) {
      verdict = `<div class="mesure-warn">⚠️ Très serré (écart estimé ${ecart.toFixed(1)} cm). À départager au réglet !</div>`;
    } else {
      const proche = d1 < d2 ? 'verte' : 'bleue';
      verdict = `<div class="mesure-verdict">La boule <strong>${proche}</strong> semble la plus proche (écart ~${ecart.toFixed(1)} cm).</div>`;
    }
    res.innerHTML = `
      <div class="mesure-dists">
        <span class="mesure-d1">🟢 Boule verte : ~${d1.toFixed(1)} cm</span>
        <span class="mesure-d2">🔵 Boule bleue : ~${d2.toFixed(1)} cm</span>
      </div>
      ${verdict}
    `;
  }

  // Accès aux points par clé
  function getPoint(key) {
    if (key === 'cal0') return mesureState.cal[0] || null;
    if (key === 'cal1') return mesureState.cal[1] || null;
    if (key === 'boule1') return mesureState.boule1;
    if (key === 'boule2') return mesureState.boule2;
    return null;
  }
  function setPoint(key, p) {
    if (key === 'cal0') mesureState.cal[0] = p;
    else if (key === 'cal1') mesureState.cal[1] = p;
    else if (key === 'boule1') mesureState.boule1 = p;
    else if (key === 'boule2') mesureState.boule2 = p;
  }
  const POINT_KEYS = ['cal0', 'cal1', 'boule1', 'boule2'];
  const POINT_LABELS = { cal0: 'le 1er bord du cochonnet', cal1: 'le bord opposé du cochonnet', boule1: 'la boule verte 🟢', boule2: 'la boule bleue 🔵' };

  // Point actif = celui que le prochain "tap" placera
  function nextUnplaced() {
    return POINT_KEYS.find(k => !getPoint(k)) || null;
  }

  function refreshPills() {
    if (mesureState.mode !== 'mesure') return;
    POINT_KEYS.forEach(k => {
      const pill = document.querySelector(`.pt-pill[data-pt="${k}"]`);
      if (!pill) return;
      pill.classList.toggle('placed', !!getPoint(k));
      pill.classList.toggle('active', mesureState.active === k);
    });
    const stepEl = document.getElementById('mesure-step');
    if (stepEl) {
      if (mesureState.active) stepEl.textContent = `Touche la photo pour placer ${POINT_LABELS[mesureState.active]} (ou glisse un point pour l'ajuster).`;
      else stepEl.textContent = '✅ Tous les points sont placés. Glisse un point pour l\'ajuster, ou touche une pastille pour le replacer.';
    }
  }

  // Trouve un point placé proche de la position écran (pour le glisser)
  function hitTestPoint(sx, sy) {
    let best = null, bestD = 22; // rayon de sélection en pixels
    POINT_KEYS.forEach(k => {
      const p = getPoint(k);
      if (!p) return;
      const sp = imgToScreen(p);
      const d = Math.hypot(sp.x - sx, sp.y - sy);
      if (d < bestD) { bestD = d; best = k; }
    });
    return best;
  }

  // Chargement de l'image
  const fileInput = document.getElementById('mesure-file');
  document.getElementById('mesure-load').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        mesureState.img = img;
        mesureState.cal = []; mesureState.boule1 = null; mesureState.boule2 = null;
        mesureState.mode = 'loupe'; mesureState.active = null;
        sizeCanvas(); fitImage(); draw();
        hint.style.display = 'none';
        document.getElementById('mesure-controls').style.display = 'block';
        document.getElementById('mesure-measure-panel').style.display = 'none';
        document.getElementById('mesure-result').innerHTML = '';
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  // Zoom
  function zoomAt(factor) {
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const before = screenToImg(cx, cy);
    mesureState.scale *= factor;
    mesureState.ox = cx - before.x * mesureState.scale;
    mesureState.oy = cy - before.y * mesureState.scale;
    draw();
  }
  document.getElementById('mesure-zoomin').addEventListener('click', () => zoomAt(1.3));
  document.getElementById('mesure-zoomout').addEventListener('click', () => zoomAt(1 / 1.3));
  document.getElementById('mesure-fit').addEventListener('click', () => { fitImage(); draw(); });

  // Activer / réinitialiser la mesure
  document.getElementById('mesure-measure').addEventListener('click', () => {
    mesureState.mode = 'mesure';
    mesureState.cal = []; mesureState.boule1 = null; mesureState.boule2 = null;
    mesureState.active = 'cal0';
    document.getElementById('mesure-measure-panel').style.display = 'block';
    document.getElementById('mesure-result').innerHTML = '';
    refreshPills(); draw();
  });
  document.getElementById('mesure-restart').addEventListener('click', () => {
    mesureState.cal = []; mesureState.boule1 = null; mesureState.boule2 = null;
    mesureState.active = 'cal0';
    document.getElementById('mesure-result').innerHTML = '';
    refreshPills(); draw();
  });
  document.getElementById('mesure-diam').addEventListener('change', e => {
    mesureState.diam = parseFloat(e.target.value) || 30;
    computeResult();
  });

  // Pastilles : choisir le point à (re)placer
  document.querySelectorAll('.pt-pill[data-pt]').forEach(pill => {
    pill.addEventListener('click', () => {
      mesureState.active = pill.dataset.pt;
      refreshPills();
    });
  });

  // Pointer : glisser un point existant pour l'ajuster, glisser le vide pour déplacer la vue,
  // tap dans le vide pour placer le point actif.
  let down = null;
  canvas.addEventListener('pointerdown', e => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const dragKey = (mesureState.mode === 'mesure') ? hitTestPoint(x, y) : null;
    down = { x, y, ox: mesureState.ox, oy: mesureState.oy, moved: false, dragKey };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!down) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const dx = x - down.x, dy = y - down.y;
    if (Math.hypot(dx, dy) > 5) down.moved = true;
    if (down.dragKey) {
      // Ajustement d'un point existant en le glissant
      setPoint(down.dragKey, screenToImg(x, y));
      mesureState.active = down.dragKey;
      computeResult(); draw(); refreshPills();
    } else {
      // Déplacement de la vue (loupe)
      mesureState.ox = down.ox + dx;
      mesureState.oy = down.oy + dy;
      draw();
    }
  });
  canvas.addEventListener('pointerup', e => {
    if (!down) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (!down.moved && mesureState.mode === 'mesure' && mesureState.img) {
      if (down.dragKey) {
        // Tap franc sur un point existant : on le sélectionne (prêt à être déplacé/replacé)
        mesureState.active = down.dragKey;
      } else if (mesureState.active) {
        // Tap dans le vide : on place le point actif ici
        setPoint(mesureState.active, screenToImg(x, y));
        mesureState.active = nextUnplaced();
        computeResult();
      }
      refreshPills();
    }
    down = null;
    draw();
  });

  // Redimensionnement (on retire un éventuel ancien écouteur pour ne pas les empiler)
  if (mesureResizeHandler) window.removeEventListener('resize', mesureResizeHandler);
  mesureResizeHandler = () => {
    if (!mesureState || !mesureState.img || !document.body.contains(canvas)) return;
    sizeCanvas(); fitImage(); draw();
  };
  window.addEventListener('resize', mesureResizeHandler);

  sizeCanvas();
}

// ============== IMPRESSION / EXPORT PAPIER ==============

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; margin: 16px; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 18px 0 8px; border-bottom: 2px solid #000; padding-bottom: 3px; }
  h3 { font-size: 13px; margin: 0 0 6px; }
  .sub { color: #444; font-size: 11px; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  th, td { border: 1px solid #888; padding: 5px 7px; text-align: left; font-size: 11px; }
  th { background: #eee; }
  .score-box { width: 38px; text-align: center; }
  /* Planning : colonnes de largeur fixe pour que tous les créneaux soient alignés à l'identique */
  table.planning-table { table-layout: fixed; }
  .planning-table th, .planning-table td { overflow: hidden; text-overflow: ellipsis; }
  .planning-table .cell-score { text-align: center; height: 30px; }
  .col-terrain { width: 9%; }
  .col-poule { width: 9%; }
  .col-match { width: 50%; }
  .col-score { width: 16%; }
  .creneau { margin-bottom: 12px; page-break-inside: avoid; }
  .creneau-h { font-weight: bold; background: #000; color: #fff; padding: 4px 8px; font-size: 12px; }
  .poule-sheet, .finale-sheet { page-break-after: always; }
  .poule-sheet:last-child, .finale-sheet:last-child { page-break-after: auto; }
  .podium { display: flex; justify-content: center; align-items: flex-end; gap: 16px; margin: 16px 0 24px; }
  .podium div { text-align: center; border: 2px solid #000; border-radius: 8px; padding: 10px 18px; min-width: 120px; }
  .podium .place { font-size: 22px; }
  .podium .eq { font-weight: bold; font-size: 14px; margin-top: 4px; }
  .podium .winner { border-width: 4px; padding: 18px 26px; min-width: 160px; background: #fff7e0; }
  .podium .winner .place { font-size: 40px; }
  .podium .winner .eq { font-size: 22px; }
  .podium .winner .muted { font-size: 13px; font-weight: bold; letter-spacing: 1px; }
  .muted { color: #555; font-size: 10px; }
  .vide { height: 22px; }
  @media print { body { margin: 8mm; } .no-print { display: none; } }
  .print-btn { position: fixed; top: 10px; right: 10px; padding: 8px 14px; font-size: 14px; cursor: pointer; }
`;

function printDocument(title, bodyHtml) {
  const w = window.open('', '_blank');
  if (!w) { toast('Autorise les fenêtres pop-up pour imprimer'); return; }
  w.document.open();
  w.document.write(
    '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + title + '</title><style>' + PRINT_CSS + '</style></head><body>' +
    '<button class="print-btn no-print" onclick="window.print()">🖨 Imprimer</button>' +
    bodyHtml +
    '</body></html>'
  );
  w.document.close();
  // Laisse le temps au rendu puis ouvre la boîte d'impression (sur PC surtout)
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 350);
}

function printHeader(s) {
  const name = escapeHtml(STATE.tournament.name);
  return `<h1>${name}</h1><p class="sub">${describePoulesComposition(s)} · ${formatLabel(s.config.format)} · ${s.config.nbTerrains} terrains</p>`;
}

// 1) Planning vue d'ensemble
function buildPrintablePlanning(s) {
  let html = printHeader(s) + '<h2>Planning des poules</h2>';
  if (!s.planning || !s.planning.poules.length) {
    html += '<p>Planning non disponible.</p>';
  } else {
    s.planning.poules.forEach((slot, i) => {
      html += `<div class="creneau"><div class="creneau-h">Créneau ${i + 1} — ${escapeHtml(slot.time)}</div>`;
      html += `<table class="planning-table">
        <colgroup><col class="col-terrain"><col class="col-poule"><col class="col-match"><col class="col-score"><col class="col-score"></colgroup>
        <tr><th>Terrain</th><th>Poule</th><th>Match</th><th class="cell-score">Score</th><th class="cell-score">Score</th></tr>`;
      slot.matches.forEach(m => {
        const pName = s.poules[m.pi] ? s.poules[m.pi].name : '?';
        html += `<tr><td>T${m.terrain}</td><td>${escapeHtml(pName)}</td><td>${escapeHtml(m.a)} &nbsp;/&nbsp; ${escapeHtml(m.b)}</td><td class="cell-score">&nbsp;</td><td class="cell-score">&nbsp;</td></tr>`;
      });
      html += '</table></div>';
    });
  }
  // Finales si planifiées
  const addBracketPlanning = (rounds, brName, br) => {
    if (!rounds || !rounds.length || !br) return '';
    let h = `<h2>Planning — ${brName}</h2>`;
    rounds.forEach(r => {
      const label = roundLabels(br.length)[r.round];
      h += `<div class="creneau"><div class="creneau-h">${label}${r.slots[0] ? ' — ' + escapeHtml(r.slots[0].time) : ''}</div>`;
      h += `<table class="planning-table">
        <colgroup><col class="col-terrain"><col class="col-match" style="width:59%"><col class="col-score"><col class="col-score"></colgroup>
        <tr><th>Terrain</th><th>Match</th><th class="cell-score">Score</th><th class="cell-score">Score</th></tr>`;
      r.slots.forEach(sl => {
        h += `<tr><td>T${sl.terrain}</td><td>${escapeHtml(sl.a || '—')} &nbsp;/&nbsp; ${escapeHtml(sl.b || '—')}</td><td class="cell-score">&nbsp;</td><td class="cell-score">&nbsp;</td></tr>`;
      });
      h += '</table></div>';
    });
    return h;
  };
  if (s.planning && s.planning.principal && s.planning.principal.length) {
    html += addBracketPlanning(s.planning.principal, 'Tableau principal', s.brPrincipal);
  }
  if (s.planning && s.planning.conso && s.planning.conso.length) {
    html += addBracketPlanning(s.planning.conso, 'Consolante', s.brConso);
  }
  return html;
}

// 2) Feuilles de poule (une par poule) + feuilles de finale
function buildPrintableMatchSheets(s) {
  let html = '';
  // Une feuille par poule
  s.poules.forEach(p => {
    html += `<div class="poule-sheet">`;
    html += printHeader(s);
    html += `<h2>Poule ${escapeHtml(p.name)} — feuille de match</h2>`;
    html += '<table><tr><th>Match</th><th>Équipe A</th><th class="score-box">Score</th><th class="score-box">Score</th><th>Équipe B</th></tr>';
    p.matches.forEach((m, i) => {
      html += `<tr><td>${i + 1}</td><td>${escapeHtml(m.a)}</td><td class="score-box">&nbsp;</td><td class="score-box">&nbsp;</td><td>${escapeHtml(m.b)}</td></tr>`;
    });
    html += '</table>';
    // Tableau de classement vierge à remplir
    html += '<h3>Classement de la poule</h3>';
    html += '<table><tr><th>Rang</th><th>Équipe</th><th>V</th><th>N</th><th>D</th><th>Pts</th><th>Diff.</th></tr>';
    p.teams.forEach((t, i) => {
      html += `<tr><td>${i + 1}</td><td>${escapeHtml(t)}</td><td></td><td></td><td></td><td></td><td></td></tr>`;
    });
    html += '</table>';
    html += `<p class="muted">Victoire = 3 pts · ${s.config.format === 'points' ? '' : 'Nul = 1 pt · '}Défaite = 0 pt. Premier à 13 points gagne.</p>`;
    html += `</div>`;
  });

  // Feuilles de finale
  const bracketSheet = (br, brName) => {
    if (!br) return '';
    let h = `<div class="finale-sheet">`;
    h += printHeader(s);
    h += `<h2>${brName} — feuille de match</h2>`;
    br.forEach((round, ri) => {
      const label = roundLabels(br.length)[ri];
      h += `<h3>${label}</h3>`;
      h += '<table><tr><th>Équipe A</th><th class="score-box">Score</th><th class="score-box">Score</th><th>Équipe B</th></tr>';
      round.forEach(m => {
        const a = m.a ? escapeHtml(m.a) : '__________';
        const b = m.b ? escapeHtml(m.b) : '__________';
        h += `<tr><td>${a}</td><td class="score-box">&nbsp;</td><td class="score-box">&nbsp;</td><td>${b}</td></tr>`;
      });
      h += '</table>';
    });
    h += `</div>`;
    return h;
  };
  html += bracketSheet(s.brPrincipal, 'Tableau principal');
  html += bracketSheet(s.brConso, 'Consolante');
  return html;
}

// 3) Résultats des poules : une feuille par poule (classement + scores réels)
function buildPrintablePouleResults(s) {
  const isPoints = s.config.format === 'points';
  let html = '';
  s.poules.forEach(p => {
    const st = computeStandings(p, s.config.format);
    html += `<div class="poule-sheet">`;
    html += printHeader(s);
    html += `<h2>Poule ${escapeHtml(p.name)} — résultats</h2>`;
    html += '<h3>Classement final</h3>';
    html += `<table><tr><th>Rang</th><th>Équipe</th><th>V</th>${isPoints ? '' : '<th>N</th>'}<th>D</th><th>Pts</th><th>Diff.</th></tr>`;
    st.forEach((row, i) => {
      const qual = i < s.config.qualif;
      html += `<tr${qual ? ' style="background:#e7f5e7;font-weight:bold;"' : ''}>` +
        `<td>${i + 1}${qual ? ' ✓' : ''}</td><td>${escapeHtml(row.team)}</td>` +
        `<td>${row.wins}</td>${isPoints ? '' : `<td>${row.draws}</td>`}<td>${row.losses}</td>` +
        `<td>${row.points}</td><td>${row.diff > 0 ? '+' : ''}${row.diff}</td></tr>`;
    });
    html += '</table>';
    html += `<p class="muted">✓ = qualifié pour le tableau principal (${s.config.qualif} premier${s.config.qualif > 1 ? 's' : ''} de chaque poule).</p>`;
    html += '<h3>Résultats des matchs</h3>';
    html += '<table><tr><th>Équipe A</th><th class="score-box">Score</th><th class="score-box">Score</th><th>Équipe B</th></tr>';
    p.matches.forEach(m => {
      const sa = m.scoreA != null ? m.scoreA : '—';
      const sb = m.scoreB != null ? m.scoreB : '—';
      const winA = m.scoreA != null && m.scoreB != null && m.scoreA > m.scoreB;
      const winB = m.scoreA != null && m.scoreB != null && m.scoreB > m.scoreA;
      html += `<tr><td${winA ? ' style="font-weight:bold;"' : ''}>${escapeHtml(m.a)}</td>` +
        `<td class="score-box">${sa}</td><td class="score-box">${sb}</td>` +
        `<td${winB ? ' style="font-weight:bold;"' : ''}>${escapeHtml(m.b)}</td></tr>`;
    });
    html += '</table>';
    html += `</div>`;
  });
  return html;
}

// 4) Récapitulatif de fin : podium + classement général
function buildPrintableRecap(s) {
  const rankingP = computeRanking(s.brPrincipal, s.petiteFinalePrincipal);
  let nbPrincipal = 0;
  if (s.brPrincipal && s.brPrincipal[0]) {
    s.brPrincipal[0].forEach(m => { if (m.a !== null) nbPrincipal++; if (m.b !== null) nbPrincipal++; });
  }
  let rows = rankingP.map(r => ({ ...r, groupe: 'principal' }));
  if (s.brConso) {
    const rankingC = computeRanking(s.brConso, s.petiteFinaleConso);
    rankingC.forEach(r => rows.push({ rang: r.rang + nbPrincipal, equipe: r.equipe, exaequo: r.exaequo, groupe: 'conso' }));
  }
  let html = printHeader(s) + '<h2>Récapitulatif du tournoi</h2>';
  // Podium
  const podium = rows.filter(r => r.rang <= 3);
  if (podium.length >= 3) {
    const byRang = r => (rows.find(x => x.rang === r) || {}).equipe || '—';
    html += `<div class="podium">
      <div><div class="place">🥈</div><div class="eq">${escapeHtml(byRang(2))}</div><div class="muted">2e place</div></div>
      <div class="winner"><div class="place">🥇</div><div class="eq">${escapeHtml(byRang(1))}</div><div class="muted">VAINQUEUR</div></div>
      <div><div class="place">🥉</div><div class="eq">${escapeHtml(byRang(3))}</div><div class="muted">3e place</div></div>
    </div>`;
  }
  // Classement général complet
  html += '<h3>Classement général</h3>';
  html += '<table><tr><th>Rang</th><th>Équipe</th><th>Tableau</th></tr>';
  rows.forEach(r => {
    const rang = r.rang <= 3 ? ['🥇', '🥈', '🥉'][r.rang - 1] : (r.rang + (r.exaequo ? 'e ex æquo' : 'e'));
    html += `<tr><td>${rang}</td><td>${escapeHtml(r.equipe)}</td><td>${r.groupe === 'conso' ? 'Consolante' : 'Principal'}</td></tr>`;
  });
  html += '</table>';
  html += `<p class="muted">Édité le ${new Date().toLocaleDateString('fr-FR')} — LeCochonnet</p>`;
  return html;
}

// ============== ADMIN EVENTS ==============

function bindStepEvents() {
  const s = STATE.tournament.state;

  // STEP TEAMS
  const ta = $('#team-add');
  if (ta) {
    const addTeam = () => {
      const input = $('#team-input');
      const name = input.value.trim();
      if (!name) return;
      if (s.teams.includes(name)) { input.value = ''; return; }
      s.teams.push(name);
      input.value = '';
      scheduleSave();
      renderAdminContent();
      setTimeout(() => $('#team-input')?.focus(), 0);
    };
    ta.addEventListener('click', addTeam);
    $('#team-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTeam(); }});
    $$('#team-list [data-rm]').forEach(b => b.addEventListener('click', e => {
      s.teams.splice(parseInt(e.currentTarget.dataset.rm), 1);
      scheduleSave();
      renderAdminContent();
    }));
    $$('#team-list [data-edit]').forEach(b => b.addEventListener('click', e => {
      const i = parseInt(e.currentTarget.dataset.edit);
      const span = $(`.team-name-text[data-name="${i}"]`);
      if (!span) return;
      // Remplace le texte par un champ de saisie pré-rempli
      const current = s.teams[i];
      const editInput = document.createElement('input');
      editInput.type = 'text';
      editInput.value = current;
      editInput.className = 'team-edit-input';
      span.replaceWith(editInput);
      editInput.focus();
      editInput.select();
      const commit = () => {
        const nv = editInput.value.trim();
        const old = s.teams[i];
        if (nv && nv !== old && !s.teams.includes(nv)) {
          s.teams[i] = nv;
          renameTeamEverywhere(s, old, nv);
          scheduleSave();
        }
        renderAdminContent();
      };
      editInput.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        if (ev.key === 'Escape') renderAdminContent();
      });
      editInput.addEventListener('blur', commit);
    }));
    $('#team-clear')?.addEventListener('click', () => {
      if (s.teams.length && !confirm('Effacer toutes les équipes ?')) return;
      s.teams = [];
      scheduleSave();
      renderAdminContent();
    });
    $('#to-config')?.addEventListener('click', () => { s.step = 'config'; scheduleSave(); renderTournoiTab($('#tab-content')); });
  }

  // STEP CONFIG
  $$('.opt-group, .opt-grid, .mode-switch').forEach(group => {
    group.addEventListener('click', e => {
      const opt = e.target.closest('[data-val]');
      if (!opt) return;
      // Ignore les options désactivées
      if (opt.dataset.disabled === 'true') return;
      group.querySelectorAll('label').forEach(l => l.classList.remove('selected'));
      opt.classList.add('selected');
      const g = group.dataset.group;
      const v = opt.dataset.val;
      const intGroups = ['pouleSize', 'qualif', 'nbTerrains', 'pauseEntreMatchs', 'nbPoules', 'tableauSize'];
      if (intGroups.includes(g)) s.config[g] = parseInt(v);
      else s.config[g] = v;
      // Le changement de mode (size/count) ou de mode de qualif redessine le bloc
      if (g === 'pouleMode' || g === 'qualifMode') {
        renderAdminContent();
        scheduleSave();
        return;
      }
      // Pour size, nbPoules : on rafraîchit le récap ET la liste des qualifiés (la min poule peut changer)
      if (g === 'pouleSize' || g === 'nbPoules') {
        renderAdminContent();
        scheduleSave();
        return;
      }
      scheduleSave();
      refreshTournamentPreview();
    });
  });

  // Boutons de suggestion d'équilibrage : passe en mode "count" et applique le nombre suggéré
  $$('[data-suggest-p]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.suggestP);
      s.config.pouleMode = 'count';
      s.config.nbPoules = p;
      renderAdminContent();
      scheduleSave();
    });
  });

  const hd = $('#heure-debut');
  if (hd) hd.addEventListener('change', e => {
    s.config.heureDebut = e.target.value || '14:00';
    scheduleSave();
    refreshTournamentPreview();
  });
  $('#back-teams')?.addEventListener('click', () => { s.step = 'teams'; scheduleSave(); renderTournoiTab($('#tab-content')); });
  $('#gen-poules')?.addEventListener('click', async () => {
    const hasScores = s.poules.some(p => p.matches.some(m => m.scoreA != null || m.scoreB != null));
    if (hasScores) {
      const ok = await confirmFort({
        titre: '⚠ Effacer le tournoi en cours ?',
        message: 'Des poules avec des scores existent déjà. Refaire un tirage va <strong>tout effacer définitivement</strong>.',
        motAValider: 'EFFACER',
        boutonLabel: 'Tout effacer et re-tirer'
      });
      if (!ok) return;
    }
    generatePoules();
    computePouleSchedule();
    s.step = 'poules';
    scheduleSave();
    renderTournoiTab($('#tab-content'));
  });

  // STEP POULES
  $('#back-config')?.addEventListener('click', async (e) => {
    if (e.currentTarget.dataset.locked === 'true') {
      const ok = await confirmFort({
        titre: 'Modifier le format ?',
        message: 'Des scores sont déjà saisis. Revenir au format risque de tout réinitialiser si tu changes la composition des poules.',
        motAValider: 'MODIFIER',
        boutonLabel: 'Revenir au format'
      });
      if (!ok) return;
    }
    s.step = 'config';
    scheduleSave();
    renderTournoiTab($('#tab-content'));
  });
  $('#reshuffle')?.addEventListener('click', async () => {
    const hasScores = s.poules.some(p => p.matches.some(m => m.scoreA != null || m.scoreB != null));
    if (hasScores) {
      const ok = await confirmFort({
        titre: '⚠ Effacer le tournoi en cours ?',
        message: 'Un nouveau tirage va <strong>effacer définitivement tous les scores déjà saisis</strong> et recomposer les poules au hasard. Cette action est irréversible.',
        motAValider: 'EFFACER',
        boutonLabel: 'Re-tirer et tout effacer'
      });
      if (!ok) return;
    } else {
      if (!confirm('Re-tirer les poules ?')) return;
    }
    generatePoules();
    computePouleSchedule();
    scheduleSave();
    renderAdminContent();
  });
  $$('input[data-p]').forEach(inp => {
    // Pendant la frappe : on enregistre seulement la valeur, SANS redessiner le classement
    // (sinon l'affichage saute à chaque chiffre tapé, surtout sur mobile).
    inp.addEventListener('input', e => {
      const pi = parseInt(e.target.dataset.p);
      const mi = parseInt(e.target.dataset.m);
      const side = e.target.dataset.s;
      const v = e.target.value === '' ? null : Math.max(0, Math.min(maxScore(), parseInt(e.target.value)));
      if (side === 'A') s.poules[pi].matches[mi].scoreA = v;
      else s.poules[pi].matches[mi].scoreB = v;
      scheduleSave();
    });
    // Quand on quitte le champ : on recalcule le classement et l'état du bouton « Valider »
    inp.addEventListener('change', () => {
      updateStandingsAndCheck();
    });
  });
  // Valider les poules : fige les scores et génère/active la phase finale
  $('#valider-poules')?.addEventListener('click', () => {
    promptValiderPoules();
  });
  // Déverrouiller les poules (action de sécurité, revient en arrière)
  $('#deverrouiller')?.addEventListener('click', async () => {
    const ok = await confirmFort({
      titre: '⚠ Déverrouiller les poules ?',
      message: 'Tu vas pouvoir à nouveau modifier les scores de poule. <strong>Attention :</strong> si tu changes un score, cela peut fausser la phase finale déjà en cours. À n\'utiliser qu\'en cas de vraie erreur.',
      motAValider: 'DEVERROUILLER',
      boutonLabel: 'Déverrouiller'
    });
    if (!ok) return;
    s.poulesVerrouillees = false;
    scheduleSave();
    renderAdminContent();
  });
  // Aller voir la phase finale directement
  $('#go-brackets-direct')?.addEventListener('click', () => {
    s.step = 'brackets';
    scheduleSave();
    renderTournoiTab($('#tab-content'));
  });

  // STEP BRACKETS
  $('#back-poules-step')?.addEventListener('click', () => { s.step = 'poules'; scheduleSave(); renderTournoiTab($('#tab-content')); });
  $$('.bracket-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.bracket-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      STATE.activeBracket = which;
      $('#bracket-principal-pane').style.display = which === 'principal' ? 'block' : 'none';
      $('#bracket-conso-pane').style.display = which === 'conso' ? 'block' : 'none';
    });
  });
  $$('input[data-br]').forEach(inp => {
    inp.addEventListener('input', e => {
      const br = e.target.dataset.br === 'principal' ? s.brPrincipal : s.brConso;
      const ri = parseInt(e.target.dataset.r);
      const mi = parseInt(e.target.dataset.m);
      const side = e.target.dataset.s;
      const v = e.target.value === '' ? null : Math.max(0, Math.min(maxScore(), parseInt(e.target.value)));
      if (side === 'A') br[ri][mi].scoreA = v;
      else br[ri][mi].scoreB = v;
      scheduleSave();
    });
    // On ne redessine qu'une fois la saisie terminée (focus perdu), pour ne pas
    // fermer le clavier ni faire sauter la page à chaque chiffre tapé.
    inp.addEventListener('change', () => {
      computeBracketSchedule();
      scheduleSave();
      renderAdminContent();
    });
  });

  // Saisie des scores de la petite finale (3e place)
  $$('input[data-pf]').forEach(inp => {
    inp.addEventListener('input', e => {
      const pf = e.target.dataset.pf === 'principal' ? s.petiteFinalePrincipal : s.petiteFinaleConso;
      if (!pf) return;
      const side = e.target.dataset.s;
      const v = e.target.value === '' ? null : Math.max(0, Math.min(maxScore(), parseInt(e.target.value)));
      if (side === 'A') pf.scoreA = v;
      else pf.scoreB = v;
      scheduleSave();
    });
    inp.addEventListener('change', () => {
      scheduleSave();
      renderAdminContent();
    });
  });

  // Valider un match de bracket (le fige)
  $$('[data-valide-br]').forEach(btn => {
    btn.addEventListener('click', e => {
      const br = e.currentTarget.dataset.valideBr === 'principal' ? s.brPrincipal : s.brConso;
      const ri = parseInt(e.currentTarget.dataset.r);
      const mi = parseInt(e.currentTarget.dataset.m);
      const m = br[ri][mi];
      if (!isMatchDecided(m)) { toast('Saisis d\'abord le score'); return; }
      m.valide = true;
      computeBracketSchedule();
      scheduleSave();
      renderAdminContent();
    });
  });
  // Modifier un match de bracket validé (confirmation forte)
  $$('[data-modif-br]').forEach(btn => {
    btn.addEventListener('click', async e => {
      const ri = parseInt(e.currentTarget.dataset.r);
      const mi = parseInt(e.currentTarget.dataset.m);
      const which = e.currentTarget.dataset.modifBr;
      const ok = await confirmFort({
        titre: 'Modifier un match validé ?',
        message: 'Ce match est verrouillé. Le modifier peut <strong>fausser la suite du tableau</strong> (le tour suivant a peut-être déjà commencé). À n\'utiliser qu\'en cas de vraie erreur.',
        motAValider: 'MODIFIER',
        boutonLabel: 'Modifier ce match'
      });
      if (!ok) return;
      const br = which === 'principal' ? s.brPrincipal : s.brConso;
      br[ri][mi].valide = false;
      scheduleSave();
      renderAdminContent();
    });
  });
  // Valider la petite finale
  $$('[data-valide-pf]').forEach(btn => {
    btn.addEventListener('click', e => {
      const pf = e.currentTarget.dataset.validePf === 'principal' ? s.petiteFinalePrincipal : s.petiteFinaleConso;
      if (!pf || !isMatchDecided(pf)) { toast('Saisis d\'abord le score'); return; }
      pf.valide = true;
      scheduleSave();
      renderAdminContent();
    });
  });
  // Modifier la petite finale validée
  $$('[data-modif-pf]').forEach(btn => {
    btn.addEventListener('click', async e => {
      const which = e.currentTarget.dataset.modifPf;
      const ok = await confirmFort({
        titre: 'Modifier la petite finale ?',
        message: 'Ce match est verrouillé. Le modifier changera le classement (3<sup>e</sup> et 4<sup>e</sup> place).',
        motAValider: 'MODIFIER',
        boutonLabel: 'Modifier'
      });
      if (!ok) return;
      const pf = which === 'principal' ? s.petiteFinalePrincipal : s.petiteFinaleConso;
      pf.valide = false;
      scheduleSave();
      renderAdminContent();
    });
  });
}

function updateStandingsAndCheck() {
  const s = STATE.tournament.state;
  s.poules.forEach((p, pi) => {
    const standings = computeStandings(p, s.config.format);
    const card = $$('.poule-card')[pi];
    if (!card) return;
    const tbody = card.querySelector('.rank tbody');
    tbody.innerHTML = standings.map((row, ri) => `
      <tr class="${ri < s.config.qualif ? 'qualif' : ''}">
        <td>${ri + 1}</td><td>${escapeHtml(row.team)}</td>
        <td><strong>${row.points}</strong></td>
        <td>${row.wins}</td><td>${row.draws}</td><td>${row.losses}</td>
        <td>${row.diff > 0 ? '+' : ''}${row.diff}</td>
      </tr>
    `).join('');
  });
  const allDone = s.poules.every(p => p.matches.every(m => isMatchDecided(m)));
  const btn = $('#valider-poules');
  if (btn) btn.disabled = !allDone;
  // Met à jour le petit message au-dessus du bouton
  const zone = $('.validation-zone');
  if (zone) {
    const msg = zone.querySelector('p');
    if (msg && allDone) { msg.textContent = '✓ Tous les matchs de poule sont terminés.'; msg.className = 'tiny mb-2'; }
    else if (msg) { msg.textContent = 'Termine tous les matchs de poule pour pouvoir valider.'; msg.className = 'tiny muted mb-2'; }
  }
}

// ============== COMPUTATIONS ==============

function generatePoules() {
  const s = STATE.tournament.state;
  const shuffled = shuffle(s.teams);
  const n = shuffled.length;
  const sizes = computePouleSizes(n, s.config);
  s.poules = [];
  let idx = 0;
  sizes.forEach((sz, i) => {
    const teams = shuffled.slice(idx, idx + sz);
    idx += sz;
    const matches = [];
    for (let a = 0; a < teams.length; a++) {
      for (let b = a + 1; b < teams.length; b++) {
        matches.push({ a: teams[a], b: teams[b], scoreA: null, scoreB: null });
      }
    }
    s.poules.push({ name: String.fromCharCode(65 + i), teams, matches });
  });
  s.brPrincipal = null;
  s.brConso = null;
  s.planning = null;
}

// Calcule la liste des tailles de poules selon le mode choisi
// Estimation prévisionnelle du déroulé du tournoi selon la config actuelle
function computeTournamentPreview(s) {
  const n = s.teams.length;
  if (n < 2) return null;
  const sizes = computePouleSizes(n, s.config);
  const nbPoules = sizes.length;

  // Phase de poules
  let totalMatchsPoules = 0;
  let rMax = 0;
  sizes.forEach(sz => {
    totalMatchsPoules += sz * (sz - 1) / 2;
    const r = (sz % 2 === 0) ? sz - 1 : sz;
    if (r > rMax) rMax = r;
  });
  const T = s.config.nbTerrains;
  const slotDur = effectiveSlotDuration(s);
  const nbCreneauxPoules = Math.max(rMax, Math.ceil(totalMatchsPoules / T), 1);
  const dureePoules = nbCreneauxPoules * slotDur;
  const finPoules = addMinutes(s.config.heureDebut, dureePoules);

  // Qualifiés / repêchage / consolante
  let nbQualifies, taillePrincipal, nbRepeches, nbConso;
  if (s.config.qualifMode === 'tableau') {
    taillePrincipal = Math.min(s.config.tableauSize, nextPowerOf2Down(n));
    nbQualifies = taillePrincipal;
    nbRepeches = 0;
    nbConso = n - taillePrincipal;
  } else {
    nbQualifies = sizes.reduce((acc, sz) => acc + Math.min(s.config.qualif, sz), 0);
    taillePrincipal = nextPowerOf2(nbQualifies);
    const reste = n - nbQualifies;
    nbRepeches = Math.min(Math.max(0, taillePrincipal - nbQualifies), reste);
    nbConso = reste - nbRepeches;
  }
  const nbToursPrincipal = taillePrincipal >= 2 ? Math.round(Math.log2(taillePrincipal)) : 0;
  const tailleConso = nbConso >= 2 ? nextPowerOf2(nbConso) : 0;
  const nbToursConso = tailleConso >= 2 ? Math.round(Math.log2(tailleConso)) : 0;

  // Phase finale : matchs et créneaux
  const matchsPrincipal = taillePrincipal >= 2 ? taillePrincipal - 1 : 0;
  const matchsConso = nbConso >= 2 ? nbConso - 1 : 0;
  const petitesFinales = (nbToursPrincipal >= 2 ? 1 : 0) + (nbToursConso >= 2 ? 1 : 0);
  const totalMatchsFinale = matchsPrincipal + matchsConso + petitesFinales;
  const nbCreneauxFinale = Math.max(nbToursPrincipal, nbToursConso, Math.ceil(totalMatchsFinale / T), totalMatchsFinale > 0 ? 1 : 0);
  const pauseInter = 10;
  const dureeFinale = nbCreneauxFinale * slotDur;
  const finTotale = totalMatchsFinale > 0 ? addMinutes(finPoules, pauseInter + dureeFinale) : finPoules;
  const dureeTotale = dureePoules + (totalMatchsFinale > 0 ? pauseInter + dureeFinale : 0);

  return {
    n, sizes, nbPoules, nbCreneauxPoules, finPoules,
    nbQualifies, nbRepeches, taillePrincipal, nbToursPrincipal,
    nbConso, nbToursConso, nbCreneauxFinale, finTotale, dureeTotale
  };
}

function formatDuree(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m < 10 ? '0' + m : m}`;
}

function renderTournamentPreview(s) {
  const p = computeTournamentPreview(s);
  if (!p) {
    return `<div class="card preview-card" id="tournament-preview"><p class="muted tiny">Ajoute des équipes pour voir l'estimation du déroulé.</p></div>`;
  }
  // Composition des poules en texte court
  const counts = {};
  p.sizes.forEach(sz => { counts[sz] = (counts[sz] || 0) + 1; });
  const compo = Object.keys(counts).map(Number).sort((a, b) => b - a)
    .map(sz => `${counts[sz]} × ${sz}`).join(' + ');

  return `
    <div class="card preview-card" id="tournament-preview">
      <h3 class="preview-title">⏱️ Aperçu prévisionnel</h3>
      <div class="preview-row"><span>Poules</span><strong>${p.nbPoules} poules (${compo} équipes)</strong></div>
      <div class="preview-row"><span>Phase de poules</span><strong>${p.nbCreneauxPoules} tours de jeu · fin vers ${escapeHtml(p.finPoules)}</strong></div>
      <div class="preview-row"><span>Qualifiés</span><strong>${s.config.qualifMode === 'tableau'
        ? `${p.taillePrincipal} équipes → tableau de ${p.taillePrincipal} (${p.nbToursPrincipal} tour${p.nbToursPrincipal > 1 ? 's' : ''})`
        : `${p.nbQualifies}${p.nbRepeches > 0 ? ` + ${p.nbRepeches} repêché${p.nbRepeches > 1 ? 's' : ''}` : ''} → tableau de ${p.taillePrincipal} (${p.nbToursPrincipal} tour${p.nbToursPrincipal > 1 ? 's' : ''})`
      }</strong></div>
      ${p.nbConso >= 2 ? `<div class="preview-row"><span>Consolante</span><strong>${p.nbConso} équipes (${p.nbToursConso} tour${p.nbToursConso > 1 ? 's' : ''})</strong></div>` : ''}
      <div class="preview-row preview-total"><span>Fin estimée</span><strong>vers ${escapeHtml(p.finTotale)} · durée ~${formatDuree(p.dureeTotale)}</strong></div>
      <p class="tiny muted mt-2">Estimation indicative à ${effectiveMatchDuration(s)} min par partie + ${s.config.pauseEntreMatchs} min de pause, sur ${s.config.nbTerrains} terrains. Le timing réel dépend du rythme des équipes.</p>
    </div>
  `;
}

function refreshTournamentPreview() {
  const el = document.getElementById('tournament-preview');
  if (el && STATE.tournament) el.outerHTML = renderTournamentPreview(STATE.tournament.state);
}

function computePouleSizes(n, config) {
  if (config.pouleMode === 'count') {
    const p = Math.min(config.nbPoules, Math.floor(n / 2));
    if (p <= 0) return [n]; // sécurité
    const baseSize = Math.floor(n / p);
    const extra = n % p;
    const sizes = [];
    // Les `extra` premières poules ont baseSize+1, les autres baseSize
    for (let i = 0; i < extra; i++) sizes.push(baseSize + 1);
    for (let i = 0; i < p - extra; i++) sizes.push(baseSize);
    return sizes;
  }
  // Mode 'size' : on vise des poules de taille `size`. Si N ne tombe pas pile,
  // on a soit (a) ceil(N/size) poules avec quelques unes de taille-1, soit
  // (b) floor(N/size) poules avec quelques unes de taille+1.
  // On choisit l'option qui rapproche le plus de la taille cible visée.
  const size = config.pouleSize;
  if (n <= size) return [n]; // une seule poule

  const nPoulesUp = Math.ceil(n / size);
  const nPoulesDown = Math.floor(n / size);
  // Option A : nPoulesUp poules, certaines à taille-1
  const sizes = [];
  if (n % size === 0) {
    for (let i = 0; i < nPoulesUp; i++) sizes.push(size);
    return sizes;
  }
  // Distribution : on prend nPoulesUp poules. Le total à atteindre est n.
  // baseSize = floor(n/nPoulesUp), extra = n - baseSize*nPoulesUp poules à baseSize+1
  const p = nPoulesUp;
  const baseSize = Math.floor(n / p);
  const extra = n % p;
  for (let i = 0; i < extra; i++) sizes.push(baseSize + 1);
  for (let i = 0; i < p - extra; i++) sizes.push(baseSize);
  return sizes;
}

// 3/1/0 ou 3/0 selon le format
function computeStandings(poule, format) {
  const stats = {};
  poule.teams.forEach(t => stats[t] = {
    team: t, points: 0, wins: 0, draws: 0, losses: 0,
    scored: 0, conceded: 0, diff: 0
  });
  poule.matches.forEach(m => {
    if (isMatchDecided(m)) {
      stats[m.a].scored += m.scoreA;
      stats[m.a].conceded += m.scoreB;
      stats[m.b].scored += m.scoreB;
      stats[m.b].conceded += m.scoreA;
      if (m.scoreA > m.scoreB) {
        stats[m.a].wins++; stats[m.a].points += 3;
        stats[m.b].losses++;
      } else if (m.scoreB > m.scoreA) {
        stats[m.b].wins++; stats[m.b].points += 3;
        stats[m.a].losses++;
      } else {
        // égalité — possible uniquement au temps
        if (format !== 'points') {
          stats[m.a].draws++; stats[m.a].points += 1;
          stats[m.b].draws++; stats[m.b].points += 1;
        } else {
          // ne devrait pas arriver, on traite comme nul si jamais
          stats[m.a].draws++; stats[m.a].points += 1;
          stats[m.b].draws++; stats[m.b].points += 1;
        }
      }
    }
  });
  Object.values(stats).forEach(s => s.diff = s.scored - s.conceded);
  return Object.values(stats).sort((x, y) =>
    y.points - x.points || y.diff - x.diff || y.scored - x.scored
  );
}

// Plus petite puissance de 2 supérieure ou égale à n (1,2,4,8,16,32...)
function nextPowerOf2(n) {
  if (n < 2) return n; // 0 ou 1 : pas d'arrondi
  return Math.pow(2, Math.ceil(Math.log2(n)));
}

// Plus grande puissance de 2 inférieure ou égale à n (pour borner la taille du tableau)
function nextPowerOf2Down(n) {
  if (n < 2) return 0;
  return Math.pow(2, Math.floor(Math.log2(n)));
}

function generateBrackets() {
  const s = STATE.tournament.state;
  const pouleOf = {}; // team -> index de sa poule (pour éviter les re-rencontres)
  const allCtx = []; // toutes les équipes avec leur contexte de classement
  s.poules.forEach((p, pIdx) => {
    const st = computeStandings(p, s.config.format);
    st.forEach((row, i) => {
      pouleOf[row.team] = pIdx;
      allCtx.push({ team: row.team, rank: i, points: row.points, diff: row.diff, scored: row.scored });
    });
  });
  const n = allCtx.length;
  const byStrength = (a, b) => a.rank - b.rank || b.points - a.points || b.diff - a.diff || b.scored - a.scored;

  let principalCtx, consoCtx;

  if (s.config.qualifMode === 'tableau') {
    // L'organisateur fixe la taille du tableau final (2,4,8,16,32), bornée par le nombre d'équipes.
    // On qualifie les T meilleures équipes au classement (1ers de poule prioritaires, puis points/diff).
    const T = Math.min(s.config.tableauSize, nextPowerOf2Down(n));
    const allTrie = [...allCtx].sort(byStrength);
    principalCtx = allTrie.slice(0, T);
    consoCtx = allTrie.slice(T);
    // Pour info : les équipes qualifiées qui ne sont pas 1ères de leur poule
    s.repechees = principalCtx.filter(c => c.rank > 0).map(c => c.team);
  } else {
    // Mode « par poule » : N premiers de chaque poule, complété à la puissance de 2 par repêchage.
    const qualifiesCtx = [];
    const reste = [];
    allCtx.forEach(c => {
      if (c.rank < s.config.qualif) qualifiesCtx.push(c);
      else reste.push(c);
    });
    const cible = nextPowerOf2(qualifiesCtx.length);
    let nbRepecher = Math.max(0, cible - qualifiesCtx.length);
    nbRepecher = Math.min(nbRepecher, reste.length);
    const resteTrie = [...reste].sort(byStrength);
    const repechesCtx = resteTrie.slice(0, nbRepecher);
    principalCtx = qualifiesCtx.concat(repechesCtx);
    consoCtx = resteTrie.slice(nbRepecher);
    s.repechees = repechesCtx.map(r => r.team);
  }

  // Tableaux : classés par force (têtes de série) + séparation des poules au 1er tour
  const principalByStrength = [...principalCtx].sort(byStrength).map(r => r.team);
  s.brPrincipal = buildBracketSeeded(principalByStrength, pouleOf);

  const consoByStrength = [...consoCtx].sort(byStrength).map(r => r.team);
  s.brConso = consoByStrength.length >= 2 ? buildBracketSeeded(consoByStrength, pouleOf) : null;

  // Petite finale (3e place) : seulement si le tableau a des demi-finales (≥ 4 équipes → ≥ 2 tours)
  s.petiteFinalePrincipal = (s.brPrincipal && s.brPrincipal.length >= 2)
    ? { a: null, b: null, scoreA: null, scoreB: null }
    : null;
  s.petiteFinaleConso = (s.brConso && s.brConso.length >= 2)
    ? { a: null, b: null, scoreA: null, scoreB: null }
    : null;
}

function buildBracket(teams) {
  if (teams.length < 2) return null;
  const size = Math.pow(2, Math.ceil(Math.log2(teams.length)));
  const padded = [...teams];
  while (padded.length < size) padded.push(null);
  const rounds = [];
  const first = [];
  for (let i = 0; i < size; i += 2) {
    first.push({
      a: padded[i],
      b: padded[i + 1],
      scoreA: padded[i + 1] === null ? 13 : null,
      scoreB: padded[i] === null ? 13 : null
    });
  }
  rounds.push(first);
  let cnt = first.length;
  while (cnt > 1) {
    cnt = cnt / 2;
    rounds.push(Array.from({ length: cnt }, () => ({ a: null, b: null, scoreA: null, scoreB: null })));
  }
  return rounds;
}

// Ordre de placement des têtes de série dans un tableau de taille `size` (puissance de 2).
// Ex. size 8 -> [1,8,4,5,2,7,3,6] : le seed 1 et le seed 2 ne peuvent se croiser qu'en finale.
function seedPositions(size) {
  let rounds = [1, 2];
  while (rounds.length < size) {
    const len = rounds.length * 2;
    const next = [];
    for (const r of rounds) {
      next.push(r);
      next.push(len + 1 - r);
    }
    rounds = next;
  }
  return rounds;
}

// Construit un tableau avec têtes de série : les meilleures équipes sont placées
// pour ne se croiser que tard, et reçoivent les éventuelles exemptions (byes).
// Si pouleOf est fourni, on évite que deux équipes de la même poule se rencontrent au 1er tour.
function buildBracketSeeded(teamsByStrength, pouleOf) {
  const n = teamsByStrength.length;
  if (n < 2) return null;
  const size = Math.pow(2, Math.ceil(Math.log2(n)));
  const order = seedPositions(size);
  // Le seed i (1-indexé) reçoit l'équipe i ; les seeds au-delà de n sont des exemptions (null).
  const slots = order.map(seed => (seed <= n ? teamsByStrength[seed - 1] : null));

  // Éviter les re-rencontres de poule au premier tour, par échanges entre matchs
  if (pouleOf) repairPouleConflicts(slots, pouleOf);

  const rounds = [];
  const first = [];
  for (let i = 0; i < size; i += 2) {
    first.push({
      a: slots[i],
      b: slots[i + 1],
      scoreA: slots[i + 1] === null ? 13 : null,
      scoreB: slots[i] === null ? 13 : null
    });
  }
  rounds.push(first);
  let cnt = first.length;
  while (cnt > 1) {
    cnt = cnt / 2;
    rounds.push(Array.from({ length: cnt }, () => ({ a: null, b: null, scoreA: null, scoreB: null })));
  }
  return rounds;
}

// Tente d'éliminer les rencontres entre équipes de même poule au premier tour,
// en échangeant des adversaires entre matchs (sans casser le placement des têtes de série).
function repairPouleConflicts(slots, pouleOf) {
  const size = slots.length;
  const samePoule = (x, y) => x && y && pouleOf[x] === pouleOf[y];
  for (let i = 0; i < size; i += 2) {
    if (!samePoule(slots[i], slots[i + 1])) continue;
    // On échange l'adversaire (position impaire) avec celui d'un autre match
    for (let j = 0; j < size; j += 2) {
      if (j === i) continue;
      const newOpp_i = slots[j + 1];
      const newOpp_j = slots[i + 1];
      if (!samePoule(slots[i], newOpp_i) && !samePoule(slots[j], newOpp_j)) {
        const tmp = slots[i + 1];
        slots[i + 1] = slots[j + 1];
        slots[j + 1] = tmp;
        break;
      }
    }
  }
}

function getMatchWinner(m) {
  if (m.a === null) return m.b;
  if (m.b === null) return m.a;
  if (isMatchDecided(m)) {
    if (m.scoreA > m.scoreB) return m.a;
    if (m.scoreB > m.scoreA) return m.b;
  }
  return null;
}

function getMatchLoser(m) {
  if (m.a === null || m.b === null) return null;
  if (isMatchDecided(m)) {
    if (m.scoreA > m.scoreB) return m.b;
    if (m.scoreB > m.scoreA) return m.a;
  }
  return null;
}

function propagateBracket(br) {
  for (let r = 0; r < br.length - 1; r++) {
    const next = br[r + 1];
    for (let i = 0; i < next.length; i++) {
      const w1 = getMatchWinner(br[r][i * 2]);
      const w2 = getMatchWinner(br[r][i * 2 + 1]);
      if (next[i].a !== w1) { next[i].a = w1; next[i].scoreA = null; }
      if (next[i].b !== w2) { next[i].b = w2; next[i].scoreB = null; }
    }
  }
}

// Récupère les demi-finales d'un bracket (l'avant-dernier tour), s'il existe
function getSemifinals(br) {
  if (!br || br.length < 2) return null;
  const semis = br[br.length - 2];
  if (semis.length !== 2) return null;
  return semis;
}

// Met à jour les participants de la petite finale (perdants des 2 demi-finales)
function propagatePetiteFinale(br, petiteFinale) {
  const semis = getSemifinals(br);
  if (!semis || !petiteFinale) return;
  const l1 = getMatchLoser(semis[0]);
  const l2 = getMatchLoser(semis[1]);
  if (petiteFinale.a !== l1) { petiteFinale.a = l1; petiteFinale.scoreA = null; }
  if (petiteFinale.b !== l2) { petiteFinale.b = l2; petiteFinale.scoreB = null; }
}

// Calcule le classement final d'un tableau
// Retourne un tableau d'objets { rang, equipe, exaequo: bool }
function computeRanking(br, petiteFinale) {
  if (!br || br.length === 0) return [];
  const ranking = [];
  const finale = br[br.length - 1][0];
  const champ = getMatchWinner(finale);
  const finaliste = getMatchLoser(finale);

  if (champ) ranking.push({ rang: 1, equipe: champ, exaequo: false });
  if (finaliste) ranking.push({ rang: 2, equipe: finaliste, exaequo: false });

  // 3e et 4e via la petite finale
  if (petiteFinale && petiteFinale.a && petiteFinale.b) {
    const w = getMatchWinner(petiteFinale);
    const l = getMatchLoser(petiteFinale);
    if (w) ranking.push({ rang: 3, equipe: w, exaequo: false });
    if (l) ranking.push({ rang: 4, equipe: l, exaequo: false });
  }

  // Les tours précédents : perdants du même tour, départagés par différence de points
  // L'avant-dernier tour = demi-finales (déjà traité via petite finale)
  // On part des quarts (br.length - 3) et on remonte
  let rang = 5;
  for (let r = br.length - 3; r >= 0; r--) {
    const losers = [];
    br[r].forEach(m => {
      const l = getMatchLoser(m);
      if (l) losers.push(l);
    });
    // Départage par différence de points sur l'ensemble des matchs de phase finale,
    // puis par points marqués. Vrai ex æquo seulement si tout est identique.
    const withStats = losers.map(eq => ({
      equipe: eq,
      diff: teamBracketDiff(br, petiteFinale, eq),
      pour: teamBracketScored(br, petiteFinale, eq)
    }));
    withStats.sort((x, y) => y.diff - x.diff || y.pour - x.pour);
    withStats.forEach((row, idx) => {
      // Est-ce un vrai ex æquo avec le précédent ou le suivant ? (mêmes stats)
      const sameAsPrev = idx > 0 && withStats[idx - 1].diff === row.diff && withStats[idx - 1].pour === row.pour;
      const sameAsNext = idx < withStats.length - 1 && withStats[idx + 1].diff === row.diff && withStats[idx + 1].pour === row.pour;
      ranking.push({
        rang: rang + idx,
        equipe: row.equipe,
        diff: row.diff,
        exaequo: sameAsPrev || sameAsNext
      });
    });
    rang += losers.length;
  }

  return ranking;
}

// Différence de points d'une équipe sur tous ses matchs de phase finale (bracket + petite finale)
function teamBracketDiff(br, petiteFinale, team) {
  let diff = 0;
  const accountMatch = m => {
    if (!isMatchDecided(m)) return;
    if (m.a === team) diff += (m.scoreA - m.scoreB);
    else if (m.b === team) diff += (m.scoreB - m.scoreA);
  };
  br.forEach(round => round.forEach(accountMatch));
  if (petiteFinale) accountMatch(petiteFinale);
  return diff;
}

// Total de points marqués par une équipe sur ses matchs de phase finale
function teamBracketScored(br, petiteFinale, team) {
  let pour = 0;
  const accountMatch = m => {
    if (!isMatchDecided(m)) return;
    if (m.a === team) pour += m.scoreA;
    else if (m.b === team) pour += m.scoreB;
  };
  br.forEach(round => round.forEach(accountMatch));
  if (petiteFinale) accountMatch(petiteFinale);
  return pour;
}

// ============== PLANNING ==============

// Algorithme glouton : crée des créneaux successifs, dans chaque créneau on remplit
// N terrains avec des matchs dont les équipes ne sont pas déjà occupées dans ce créneau
// Génère les journées d'un round-robin (méthode du cercle).
// Chaque journée = liste de matchs [a, b] où aucune équipe ne joue deux fois.
function roundRobinRounds(teams) {
  const arr = teams.slice();
  if (arr.length % 2 === 1) arr.push(null); // équipe fictive = repos
  const n = arr.length;
  const rounds = [];
  const fixed = arr[0];
  let rest = arr.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const line = [fixed, ...rest];
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const t1 = line[i], t2 = line[n - 1 - i];
      if (t1 !== null && t2 !== null) round.push([t1, t2]);
    }
    rounds.push(round);
    rest = [rest[rest.length - 1], ...rest.slice(0, rest.length - 1)];
  }
  return rounds;
}

function schedulePouleMatches(poules, nbTerrains) {
  const M = poules.reduce((s, p) => s + p.matches.length, 0);
  if (M === 0) return [];

  // Nombre minimum de créneaux : imposé par la plus grande poule (une équipe ne joue
  // qu'un match à la fois) ET par la capacité en terrains.
  let rMax = 0;
  poules.forEach(p => {
    const n = p.teams.length;
    const r = (n % 2 === 0) ? n - 1 : n;
    if (r > rMax) rMax = r;
  });
  const nbCreneaux = Math.max(rMax, Math.ceil(M / nbTerrains), 1);

  const slots = Array.from({ length: nbCreneaux }, () => ({ matches: [], teams: new Set() }));

  // On traite les poules de la plus grande à la plus petite, et on étale leurs journées
  // sur l'ensemble des créneaux pour équilibrer la charge (pas de créneau quasi-vide à la fin).
  const order = poules.map((p, pi) => ({ p, pi })).sort((x, y) => y.p.teams.length - x.p.teams.length);
  let polIdx = 0;

  order.forEach(({ p, pi }) => {
    const pairIndex = {};
    p.matches.forEach((m, mi) => { pairIndex[m.a + '|' + m.b] = mi; pairIndex[m.b + '|' + m.a] = mi; });
    const rounds = roundRobinRounds(p.teams);
    const R = rounds.length;
    const offset = polIdx++; // décale chaque poule pour éviter que toutes visent les mêmes créneaux

    rounds.forEach((round, j) => {
      let target = (R <= 1) ? 0 : Math.round(j * (nbCreneaux - 1) / (R - 1));
      target = (target + offset) % nbCreneaux;
      round.forEach(([a, b]) => {
        const mi = pairIndex[a + '|' + b];
        const match = { pi, mi, a, b };
        // On cherche un créneau proche de la cible, sans conflit d'équipe et avec un terrain libre
        const orderIdx = [];
        for (let d = 0; d < nbCreneaux; d++) {
          if (target + d < nbCreneaux) orderIdx.push(target + d);
          if (d > 0 && target - d >= 0) orderIdx.push(target - d);
        }
        let placed = false;
        for (const i of orderIdx) {
          const sl = slots[i];
          if (sl.matches.length >= nbTerrains) continue;
          if (sl.teams.has(a) || sl.teams.has(b)) continue;
          sl.matches.push(match); sl.teams.add(a); sl.teams.add(b); placed = true; break;
        }
        if (!placed) slots.push({ matches: [match], teams: new Set([a, b]) });
      });
    });
  });

  // On ordonne les créneaux du plus rempli au moins rempli : ainsi tout le monde
  // commence à jouer dès le premier créneau, et seuls les derniers créneaux peuvent
  // être allégés (jamais le début), sauf si c'est mathématiquement inévitable.
  const nonEmpty = slots.filter(sl => sl.matches.length > 0);
  nonEmpty.sort((a, b) => b.matches.length - a.matches.length);
  return nonEmpty.map(sl => sl.matches.map((m, idx) => ({ pi: m.pi, mi: m.mi, a: m.a, b: m.b, terrain: idx + 1 })));
}

function computePouleSchedule() {
  const s = STATE.tournament.state;
  if (!s.poules || s.poules.length === 0) return;
  const slots = schedulePouleMatches(s.poules, s.config.nbTerrains);
  const dur = effectiveSlotDuration(s);
  if (!s.planning) s.planning = { poules: [], principal: [], conso: [] };
  s.planning.poules = slots.map((slot, i) => ({
    time: addMinutes(s.config.heureDebut, i * dur),
    matches: slot
  }));
  // reset les plannings de finales puisque les poules ont changé
  s.planning.principal = [];
  s.planning.conso = [];
}

// Pour les brackets : on planifie tour par tour. Quand un tour est connu (tous les matchs ont des participants),
// on lui attribue un créneau (heure unique pour le tour, terrains 1..N).
// L'heure de départ du tour 1 = après la fin des poules. Chaque tour suivant prend +dur.
function computeBracketSchedule() {
  const s = STATE.tournament.state;
  if (!s.planning) s.planning = { poules: [], principal: [], conso: [] };
  if (!s.brPrincipal) return;
  const dur = effectiveSlotDuration(s);
  // Heure de début des finales : soit fixée manuellement, soit calculée après les poules
  let startFinales;
  if (s.config.heureFinales) {
    startFinales = s.config.heureFinales;
  } else {
    const lastPouleSlot = s.planning.poules.length > 0
      ? s.planning.poules[s.planning.poules.length - 1].time
      : s.config.heureDebut;
    startFinales = addMinutes(lastPouleSlot, dur + 10); // pause de 10 min entre poules et finales
  }

  s.planning.principal = scheduleBracketRounds(s.brPrincipal, startFinales, dur, s.config.nbTerrains);
  if (s.brConso) {
    s.planning.conso = scheduleBracketRounds(s.brConso, startFinales, dur, s.config.nbTerrains);
  } else {
    s.planning.conso = [];
  }
}

function recomputeBracketSchedule() {
  computeBracketSchedule();
}

// Pour chaque tour, attribue un horaire et des terrains
function scheduleBracketRounds(bracket, startTime, dur, nbTerrains) {
  const result = [];
  let currentTime = startTime;
  for (let ri = 0; ri < bracket.length; ri++) {
    const round = bracket[ri];
    // Filtre les matchs "réels" (avec 2 équipes, donc qui doivent être joués)
    const realMatches = [];
    round.forEach((m, mi) => {
      if (m.a !== null && m.b !== null) realMatches.push({ ri, mi });
    });
    const slots = [];
    // Si plus de matchs réels que de terrains, on fait plusieurs slots
    let idx = 0;
    let slotTime = currentTime;
    while (idx < realMatches.length) {
      const slotMatches = [];
      for (let t = 0; t < nbTerrains && idx < realMatches.length; t++) {
        slotMatches.push({ ...realMatches[idx], terrain: t + 1 });
        idx++;
      }
      slots.push({ time: slotTime, matches: slotMatches });
      slotTime = addMinutes(slotTime, dur);
    }
    result.push({ round: ri, slots });
    // Le prochain tour démarre après la fin du dernier slot de ce tour (+ pause 5 min)
    if (slots.length > 0) {
      currentTime = addMinutes(slots[slots.length - 1].time, dur + 5);
    }
  }
  return result;
}

function findScheduleForPouleMatch(s, pi, mi) {
  if (!s.planning || !s.planning.poules) return null;
  for (const slot of s.planning.poules) {
    const found = slot.matches.find(m => m.pi === pi && m.mi === mi);
    if (found) return { terrain: found.terrain, time: slot.time };
  }
  return null;
}

function findScheduleForBracketMatch(s, key, ri, mi) {
  if (!s.planning) return null;
  const rounds = key === 'principal' ? s.planning.principal : s.planning.conso;
  if (!rounds) return null;
  const round = rounds.find(r => r.round === ri);
  if (!round) return null;
  for (const slot of round.slots) {
    const found = slot.matches.find(m => m.mi === mi);
    if (found) return { terrain: found.terrain, time: slot.time };
  }
  return null;
}

// ============== PLANNING TAB ==============

function renderPlanningTab(container) {
  const s = STATE.tournament.state;
  if (!s.planning || (!s.planning.poules.length && !s.planning.principal.length)) {
    container.innerHTML = `<div class="empty">Le planning sera disponible une fois les poules tirées.</div>`;
    return;
  }
  let html = '';

  // Panneau de réglage (admin uniquement)
  if (STATE.mode === 'admin') {
    html += `
      <div class="card planning-reglage">
        <h3 class="mb-2">⚙️ Ajuster le planning</h3>
        <p class="tiny muted mb-2">Modifie les horaires en cours de tournoi : tout est recalculé pour que les équipes repartent ensemble.</p>
        <div class="reglage-grid">
          <label class="field">
            <span class="label-text">Heure de début (poules)</span>
            <input type="time" id="rg-heure-debut" value="${escapeHtml(s.config.heureDebut)}" />
          </label>
          <label class="field">
            <span class="label-text">Durée d'un match (min)</span>
            <input type="number" id="rg-duree" min="5" max="90" value="${effectiveMatchDuration(s)}" />
          </label>
          <label class="field">
            <span class="label-text">Pause entre matchs (min)</span>
            <input type="number" id="rg-pause" min="0" max="60" value="${s.config.pauseEntreMatchs}" />
          </label>
          <label class="field">
            <span class="label-text">Début phase finale</span>
            <input type="time" id="rg-heure-finales" value="${escapeHtml(s.config.heureFinales || '')}" />
          </label>
        </div>
        <div class="row tight mt-2" style="flex-wrap: wrap;">
          <button class="primary" id="rg-appliquer">Recalculer le planning</button>
          <button class="ghost" id="rg-decaler">Décaler tout de…</button>
        </div>
        <div class="row tight mt-2" style="flex-wrap: wrap;">
          <button class="ghost" id="print-planning">🖨 Imprimer le planning</button>
          <button class="ghost" id="print-sheets">🖨 Feuilles de match</button>
          <button class="ghost" id="print-poule-results">🖨 Résultats des poules</button>
        </div>
        <p class="tiny muted mt-2">Laisse « Début phase finale » vide pour enchaîner automatiquement après les poules.</p>
      </div>
    `;
  }

  // Planning des poules
  if (s.planning.poules.length > 0) {
    html += `<div class="card"><h3 class="mb-2">Phase de poules</h3>`;
    html += renderPlanningSlots(s.planning.poules, 'poule');
    html += `</div>`;
  }

  // Planning des finales
  if (s.planning.principal && s.planning.principal.length > 0 && s.brPrincipal) {
    html += `<div class="card"><h3 class="mb-2">Tableau principal</h3>`;
    s.planning.principal.forEach(r => {
      const label = roundLabels(s.brPrincipal.length)[r.round];
      html += `<h4 class="planning-round-label">${label}</h4>`;
      html += renderPlanningSlots(r.slots, 'bracket', 'principal', r.round);
    });
    html += `</div>`;
  }
  if (s.planning.conso && s.planning.conso.length > 0 && s.brConso) {
    html += `<div class="card"><h3 class="mb-2">Consolante</h3>`;
    s.planning.conso.forEach(r => {
      const label = roundLabels(s.brConso.length)[r.round];
      html += `<h4 class="planning-round-label">${label}</h4>`;
      html += renderPlanningSlots(r.slots, 'bracket', 'conso', r.round);
    });
    html += `</div>`;
  }
  container.innerHTML = html;

  // Handlers du panneau de réglage
  if (STATE.mode === 'admin') {
    $('#rg-appliquer')?.addEventListener('click', () => {
      const hd = $('#rg-heure-debut').value;
      const duree = parseInt($('#rg-duree').value);
      const pause = parseInt($('#rg-pause').value);
      const hf = $('#rg-heure-finales').value;
      if (hd) s.config.heureDebut = hd;
      if (!isNaN(duree) && duree > 0) s.config.dureeMatchOverride = duree;
      if (!isNaN(pause) && pause >= 0) s.config.pauseEntreMatchs = pause;
      s.config.heureFinales = hf || null;
      computePouleSchedule();
      computeBracketSchedule();
      scheduleSave();
      renderPlanningTab(container);
      toast('Planning recalculé');
    });
    $('#rg-decaler')?.addEventListener('click', () => {
      promptDecalage(container);
    });
    $('#print-planning')?.addEventListener('click', () => {
      printDocument('Planning — ' + STATE.tournament.name, buildPrintablePlanning(s));
    });
    $('#print-sheets')?.addEventListener('click', () => {
      printDocument('Feuilles de match — ' + STATE.tournament.name, buildPrintableMatchSheets(s));
    });
  }
}

// Décale tout le planning de X minutes (sans rien recalculer d'autre)
function promptDecalage(container) {
  const s = STATE.tournament.state;
  const wrap = document.createElement('div');
  wrap.className = 'modal-bg';
  wrap.innerHTML = `
    <div class="modal">
      <h2>Décaler le planning</h2>
      <p>De combien de minutes veux-tu décaler tous les horaires ? (un nombre négatif avance le planning)</p>
      <input type="number" id="decalage-min" value="15" step="5" />
      <div class="modal-actions">
        <button class="ghost" id="decalage-cancel">Annuler</button>
        <button class="primary" id="decalage-ok">Décaler</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('#decalage-cancel').addEventListener('click', close);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  wrap.querySelector('#decalage-ok').addEventListener('click', () => {
    const mins = parseInt(wrap.querySelector('#decalage-min').value);
    if (isNaN(mins) || mins === 0) { close(); return; }
    // On décale l'heure de début (et l'heure des finales si fixée), puis on recalcule
    s.config.heureDebut = addMinutes(s.config.heureDebut, mins);
    if (s.config.heureFinales) s.config.heureFinales = addMinutes(s.config.heureFinales, mins);
    computePouleSchedule();
    computeBracketSchedule();
    scheduleSave();
    close();
    renderPlanningTab(container);
    toast(`Planning décalé de ${mins} min`);
  });
}

function renderPlanningSlots(slots, kind, bracketKey, roundIdx) {
  const s = STATE.tournament.state;
  return slots.map(slot => `
    <div class="planning-slot">
      <div class="planning-time">${escapeHtml(slot.time)}</div>
      <div class="planning-matches">
        ${slot.matches.map(m => {
          let teamA, teamB, scoreA, scoreB;
          if (kind === 'poule') {
            const poule = s.poules[m.pi];
            const match = poule.matches[m.mi];
            teamA = match.a; teamB = match.b;
            scoreA = match.scoreA; scoreB = match.scoreB;
          } else {
            const br = bracketKey === 'principal' ? s.brPrincipal : s.brConso;
            const match = br[roundIdx][m.mi];
            teamA = match.a; teamB = match.b;
            scoreA = match.scoreA; scoreB = match.scoreB;
          }
          const decided = scoreA != null && scoreB != null;
          return `
            <div class="planning-match ${decided ? 'done' : ''}">
              <span class="planning-terrain">T${m.terrain}</span>
              <span class="planning-teams">
                <span ${decided && scoreA > scoreB ? 'class="bracket-winner"' : (decided ? 'class="bracket-loser"' : '')}>${escapeHtml(teamA ?? '—')}</span>
                <span class="planning-score">${scoreA ?? '–'} · ${scoreB ?? '–'}</span>
                <span ${decided && scoreB > scoreA ? 'class="bracket-winner"' : (decided ? 'class="bracket-loser"' : '')}>${escapeHtml(teamB ?? '—')}</span>
              </span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `).join('');
}

// ============== RÈGLEMENT TAB ==============

// Décrit la composition réelle des poules (ex. "4 poules de 4 équipes" ou "3 poules de 4 et 1 poule de 3")
function describePoulesComposition(s) {
  if (!s.poules || s.poules.length === 0) return 'Les équipes sont réparties en poules.';
  const counts = {};
  s.poules.forEach(p => {
    const n = p.teams.length;
    counts[n] = (counts[n] || 0) + 1;
  });
  const tailles = Object.keys(counts).map(Number).sort((a, b) => b - a);
  const parts = tailles.map(t => {
    const c = counts[t];
    return `${c} poule${c > 1 ? 's' : ''} de ${t} équipe${t > 1 ? 's' : ''}`;
  });
  // Joindre avec "et" pour le dernier
  let phrase;
  if (parts.length === 1) phrase = parts[0];
  else phrase = parts.slice(0, -1).join(', ') + ' et ' + parts[parts.length - 1];
  return phrase.charAt(0).toUpperCase() + phrase.slice(1) + '.';
}

function reglementBodyHtml(s) {
  const fmt = s.config.format;
  const isPoints = fmt === 'points';
  return `
      <h3>Format des parties</h3>
      <p>
        ${isPoints
          ? 'Les parties se jouent en <strong>13 points</strong>. La première équipe qui atteint 13 points gagne immédiatement le match : il n\'y a pas de règle des deux points d\'écart, et le score ne dépasse jamais 13.'
          : `Les parties se jouent <strong>au temps</strong> : durée fixée à <strong>${matchDuration(fmt)} minutes</strong>. Mais attention : <strong>la première équipe qui atteint 13 points a gagné immédiatement</strong>, même avant la fin du temps. Si personne n'a atteint 13 à la sonnerie, on termine la mène en cours et l'équipe en tête l'emporte (match nul si égalité parfaite). Le score ne dépasse donc <strong>jamais 13 points</strong>, en poules comme en phase finale.`
        }
      </p>

      <h3>Phase de poules</h3>
      <p>
        ${describePoulesComposition(s)} Chaque équipe rencontre toutes les autres équipes de sa poule.
      </p>
      <p><strong>Système de points :</strong></p>
      <ul>
        <li><strong>Victoire : 3 points</strong></li>
        ${!isPoints ? '<li><strong>Match nul : 1 point</strong></li>' : ''}
        <li><strong>Défaite : 0 point</strong></li>
      </ul>
      <p><strong>En cas d'égalité au classement</strong>, les équipes sont départagées par :</p>
      <ol>
        <li>La différence de points (points marqués − points encaissés)</li>
        <li>Le total de points marqués</li>
      </ol>
      ${s.config.qualifMode === 'tableau'
        ? `<p>La phase finale se joue sur un <strong>tableau de ${s.config.tableauSize} équipes</strong>. Les <strong>${s.config.tableauSize} meilleures équipes</strong> du tournoi y sont qualifiées : d'abord les premiers de poule, puis les meilleurs suivants (départagés au nombre de points, puis à la différence de points). Les autres équipes jouent la <strong>consolante</strong>.</p>`
        : `<p>Les <strong>${s.config.qualif} premier${s.config.qualif > 1 ? 's' : ''}</strong> de chaque poule sont qualifié${s.config.qualif > 1 ? 's' : ''} pour le tableau principal. Les autres équipes jouent la <strong>consolante</strong>.</p>
      <p>Pour que le tableau principal soit complet et équilibré (2, 4, 8, 16 ou 32 équipes, sans exemption), les <strong>meilleurs non-qualifiés sont repêchés</strong> autant que nécessaire pour atteindre le bon nombre d'équipes.</p>
      <p>Le choix des repêchés suit cet ordre :</p>
      <ol>
        <li>D'abord selon la <strong>place obtenue en poule</strong> : les meilleurs 3<sup>es</sup> sont repêchés avant les 4<sup>es</sup>, et ainsi de suite.</li>
        <li>Entre équipes de même place, on regarde le <strong>nombre de points</strong> (3 par victoire).</li>
        <li>En cas d'égalité, la <strong>différence de points</strong> (points marqués − points encaissés).</li>
        <li>Et enfin, le <strong>total de points marqués</strong>.</li>
      </ol>
      <p class="tiny muted">Exemple : si l'on qualifie les 3 premiers de chaque poule et qu'il manque des équipes pour compléter le tableau, on repêche les meilleurs 4<sup>es</sup> selon ces critères.</p>`
      }

      <h3>Phases finales</h3>
      <p>À l'issue des poules, les qualifiés disputent le <strong>tableau principal</strong> et les autres équipes le <strong>tableau de la consolante</strong>, tous deux en <strong>élimination directe</strong> : une défaite et c'est terminé.</p>
      <p>Le tableau est construit avec des <strong>têtes de série</strong> : les mieux classées en poule sont réparties pour ne se rencontrer que le plus tard possible, et un premier de poule affronte en général un deuxième (ou une équipe moins bien classée) au premier tour. On évite aussi, autant que possible, que <strong>deux équipes d'une même poule se re-rencontrent dès le premier tour</strong> (puisqu'elles se sont déjà affrontées).</p>
      <p>Les matchs nuls ne sont pas autorisés en phase finale : ${isPoints ? 'on joue en 13 points, il y a donc forcément un vainqueur' : 'en cas d\'égalité à la sonnerie, on joue une mène de prolongation pour départager'}.</p>
      <p>Une <strong>petite finale</strong> oppose les deux perdants des demi-finales pour désigner la 3<sup>e</sup> place (dans le tableau principal comme dans la consolante).</p>
      <p>Dans la <strong>consolante</strong>, si le nombre d'équipes ne tombe pas juste, les <strong>mieux classées en poule sont exemptées du premier tour</strong> et qualifiées directement pour le tour suivant. C'est l'équivalent des têtes de série : les meilleures équipes ne sont pas pénalisées par un tour de jeu supplémentaire.</p>

      <h3>Classement général</h3>
      <p>Le classement final combine les deux tableaux : les équipes du <strong>tableau principal</strong> occupent les premières places, puis celles de la <strong>consolante</strong> suivent dans la continuité.</p>
      <p>Le détail des places :</p>
      <ul>
        <li><strong>1<sup>re</sup></strong> : vainqueur de la finale</li>
        <li><strong>2<sup>e</sup></strong> : finaliste</li>
        <li><strong>3<sup>e</sup></strong> : vainqueur de la petite finale</li>
        <li><strong>4<sup>e</sup></strong> : perdant de la petite finale</li>
        <li>Ensuite, les équipes éliminées au même tour sont <strong>départagées à la différence de points</strong> (points marqués − points encaissés) sur l'ensemble de leurs matchs de phase finale, puis au total de points marqués.</li>
      </ul>

      <h3>Organisation pratique</h3>
      <ul>
        <li><strong>${s.config.nbTerrains} terrains</strong> simultanés</li>
        <li>Début : <strong>${escapeHtml(s.config.heureDebut)}</strong></li>
        <li>Pause de <strong>${s.config.pauseEntreMatchs} minutes</strong> entre deux matchs (transmission des scores, relance)</li>
        <li>Le planning détaillé est dans l'onglet <em>Planning</em></li>
      </ul>

      <h3>🎯 Compteur de points</h3>
      <p>Un onglet <strong>Compteur</strong> est à votre disposition pour vous aider à suivre le score pendant vos parties. Saisissez les points mène par mène sur votre téléphone, le total se calcule automatiquement.</p>
      <p class="tiny muted">À noter : ce compteur sert uniquement à vous aider à mémoriser le score pendant la partie. Le score officiel reste celui transmis à l'organisateur en fin de match.</p>

      <p class="tiny muted mt-3">Toute contestation est tranchée par l'organisateur du tournoi. Bonne pétanque à toutes et tous !</p>
  `;
}

function renderReglementTab(container) {
  const s = STATE.tournament.state;
  container.innerHTML = `
    <div class="card reglement">
      <div class="row mb-2" style="justify-content: space-between; flex-wrap: wrap; gap: 8px;">
        <h2 style="margin: 0;">Règlement du tournoi</h2>
        <button class="btn ghost tiny" id="print-reglement">🖨 Imprimer</button>
      </div>
      <p class="muted tiny mb-2">${escapeHtml(STATE.tournament.name)}</p>
      ${reglementBodyHtml(s)}
    </div>
  `;
  $('#print-reglement')?.addEventListener('click', () => {
    printDocument('Règlement — ' + STATE.tournament.name,
      printHeader(s) + '<h2>Règlement du tournoi</h2>' + reglementBodyHtml(s));
  });
}

// ============== PLAN DES TERRAINS ==============

// ===== Bibliothèque de plans de terrains (enregistrés localement sur l'appareil) =====
const PLANS_LIB_KEY = 'lecochonnet_plans';

function getPlansLibrary() {
  try {
    const raw = localStorage.getItem(PLANS_LIB_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function savePlanToLibrary(name, dataUrl) {
  const lib = getPlansLibrary();
  const id = 'plan_' + Date.now();
  lib.push({ id, name: name || 'Plan', dataUrl });
  try {
    localStorage.setItem(PLANS_LIB_KEY, JSON.stringify(lib));
    return true;
  } catch (e) {
    toast("Mémoire pleine : impossible d'enregistrer ce plan");
    return false;
  }
}

function deletePlanFromLibrary(id) {
  const lib = getPlansLibrary().filter(p => p.id !== id);
  try { localStorage.setItem(PLANS_LIB_KEY, JSON.stringify(lib)); } catch (e) {}
}

// Modale de sélection d'un plan dans la bibliothèque. onPick(plan) est appelé au choix.
function openPlansPicker(onPick) {
  const lib = getPlansLibrary();
  const wrap = document.createElement('div');
  wrap.className = 'modal-bg';
  wrap.innerHTML = `
    <div class="modal" style="max-width: 520px;">
      <h2>Choisir un plan enregistré</h2>
      ${lib.length === 0
        ? '<p class="muted">Aucun plan enregistré pour le moment. Charge un plan, puis enregistre-le dans ta bibliothèque pour le réutiliser.</p>'
        : `<div class="plans-picker-grid">
            ${lib.map(p => `
              <div class="plan-thumb" data-pick="${p.id}">
                <img src="${escapeHtml(p.dataUrl)}" alt="${escapeHtml(p.name)}" />
                <span>${escapeHtml(p.name)}</span>
              </div>
            `).join('')}
          </div>`
      }
      <div class="modal-actions">
        <button class="ghost" id="plans-picker-cancel">Fermer</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('#plans-picker-cancel').addEventListener('click', close);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  wrap.querySelectorAll('[data-pick]').forEach(el => {
    el.addEventListener('click', () => {
      const plan = lib.find(p => p.id === el.dataset.pick);
      if (plan) onPick(plan);
      close();
    });
  });
}

function renderPlanTab(container) {
  const s = STATE.tournament.state;
  const isAdmin = STATE.mode === 'admin';
  const plan = s.planTerrains;

  let html = '';

  if (plan && plan.dataUrl) {
    html = `
      <div class="card plan-card">
        <div class="row mb-2" style="justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <h3 style="margin: 0;">Plan des terrains</h3>
          ${isAdmin ? `
            <div class="row tight">
              <button class="ghost tiny" id="btn-change-plan">Remplacer</button>
              <button class="ghost tiny" id="btn-lib-plan">Bibliothèque</button>
              <button class="ghost tiny" id="btn-save-lib">Enregistrer</button>
              <button class="ghost tiny danger" id="btn-remove-plan">Supprimer</button>
            </div>
          ` : ''}
        </div>
        <img id="plan-img" src="${escapeHtml(plan.dataUrl)}" alt="Plan des terrains"
             style="max-width: 100%; height: auto; display: block; margin: 0 auto; border-radius: var(--radius); cursor: zoom-in;" />
        <p class="tiny muted center mt-2">Touchez l'image pour l'agrandir</p>
      </div>
    `;
  } else {
    html = `
      <div class="card">
        ${isAdmin ? `
          <h3 class="mb-2">Plan des terrains</h3>
          <p class="muted tiny mb-2">Ajoute une photo ou un schéma du terrain pour aider les joueurs à se repérer. L'image sera compressée automatiquement.</p>
          <div class="center" style="padding: 24px;">
            <div class="row" style="justify-content: center; gap: 8px; flex-wrap: wrap;">
              <button class="primary" id="btn-add-plan">📷 Charger un plan</button>
              <button class="btn ghost" id="btn-lib-plan">📍 Choisir un plan enregistré</button>
            </div>
          </div>
          <p class="tiny muted center">Formats acceptés : JPG, PNG, HEIC (iPhone) — max 10 Mo</p>
        ` : `
          <div class="empty">Pas encore de plan disponible pour ce tournoi.</div>
        `}
      </div>
    `;
  }

  container.innerHTML = html;

  // Input file caché qu'on déclenche au clic sur les boutons
  if (isAdmin) {
    const handleFile = async (file) => {
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        toast('Image trop lourde (max 10 Mo)');
        return;
      }
      try {
        toast('Compression en cours…');
        const compressed = await compressImage(file, 1600, 0.8);
        s.planTerrains = { dataUrl: compressed, name: file.name };
        scheduleSave();
        renderPlanTab(container);
        toast('Plan enregistré');
      } catch (e) {
        console.error(e);
        toast('Erreur : impossible de charger l\'image');
      }
    };

    const triggerFile = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.style.display = 'none';
      inp.addEventListener('change', e => {
        const file = e.target.files[0];
        handleFile(file);
      });
      document.body.appendChild(inp);
      inp.click();
      setTimeout(() => inp.remove(), 1000);
    };

    $('#btn-add-plan')?.addEventListener('click', triggerFile);
    $('#btn-change-plan')?.addEventListener('click', triggerFile);
    $('#btn-remove-plan')?.addEventListener('click', () => {
      if (!confirm('Supprimer le plan des terrains ?')) return;
      s.planTerrains = null;
      scheduleSave();
      renderPlanTab(container);
    });

    // Choisir un plan déjà enregistré dans la bibliothèque
    $('#btn-lib-plan')?.addEventListener('click', () => {
      openPlansPicker((picked) => {
        s.planTerrains = { dataUrl: picked.dataUrl, name: picked.name };
        scheduleSave();
        renderPlanTab(container);
        toast('Plan appliqué');
      });
    });

    // Enregistrer le plan actuel dans la bibliothèque (pour le réutiliser ailleurs)
    $('#btn-save-lib')?.addEventListener('click', () => {
      if (!s.planTerrains || !s.planTerrains.dataUrl) return;
      const defname = (s.planTerrains.name || 'Plan').replace(/\.[^.]+$/, '');
      const name = prompt('Nom du plan dans la bibliothèque :', defname);
      if (name === null) return;
      if (savePlanToLibrary(name.trim() || 'Plan', s.planTerrains.dataUrl)) {
        toast('Plan ajouté à la bibliothèque');
      }
    });
  }

  // Clic sur l'image pour zoom plein écran
  $('#plan-img')?.addEventListener('click', () => {
    openImageFullscreen(plan.dataUrl);
  });
}

// Compresse une image : on la redimensionne à maxDim max et on l'exporte en JPEG
async function compressImage(file, maxDim = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image illisible'));
      img.onload = () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round(h * (maxDim / w));
            w = maxDim;
          } else {
            w = Math.round(w * (maxDim / h));
            h = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Affichage plein écran d'une image
function openImageFullscreen(src) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-bg';
  wrap.style.padding = '0';
  wrap.innerHTML = `
    <div style="position: relative; max-width: 100vw; max-height: 100vh; display: flex; align-items: center; justify-content: center;">
      <img src="${escapeHtml(src)}" style="max-width: 100vw; max-height: 100vh; object-fit: contain;" />
      <button class="primary" style="position: absolute; top: 16px; right: 16px;" id="close-fs">Fermer</button>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  $('#close-fs').addEventListener('click', close);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
}

// ============== SHARE ==============

function publicUrl(slug) {
  return window.location.origin + window.location.pathname + '#/t/' + slug;
}

function showShareModal() {
  const t = STATE.tournament;
  const url = publicUrl(t.slug);
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=' + encodeURIComponent(url);
  const wrap = document.createElement('div');
  wrap.className = 'modal-bg';
  wrap.innerHTML = `
    <div class="modal">
      <h2>Partager le tournoi</h2>
      <p class="muted tiny mb-2">À imprimer ou afficher au stade. Les visiteurs scannent le QR ou cliquent sur le lien.</p>
      <div class="qr-block">
        <img id="qr-img" src="${qrUrl}" alt="QR code du tournoi" width="220" height="220"
             style="background: white; padding: 8px; border-radius: var(--radius); display: block;" />
        <div class="qr-info">
          <div class="tiny muted">Lien public :</div>
          <div class="qr-url">${escapeHtml(url)}</div>
          <button class="mt-2" id="copy-url">Copier le lien</button>
          <button class="mt-2" id="open-qr" style="margin-left: 6px;">Ouvrir le QR seul</button>
        </div>
      </div>
      <div class="modal-actions">
        <button class="primary" id="modal-close">Fermer</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  $('#copy-url').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); toast('Lien copié'); } catch {}
  });
  $('#open-qr').addEventListener('click', () => {
    // Ouvre une grande version du QR dans un nouvel onglet, utile pour l'imprimer
    const big = 'https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=20&data=' + encodeURIComponent(url);
    window.open(big, '_blank');
  });
  $('#modal-close').addEventListener('click', () => wrap.remove());
  wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
}

// ============== PUBLIC VIEW ==============

async function loadAndRenderPublic(slug) {
  app.innerHTML = `${topbar({ showUser: false })}<div class="empty" style="margin-top: 40px;">Chargement…</div>`;
  bindTopbar();
  try {
    const t = await getTournament(slug);
    if (!t || !t.is_public) {
      app.innerHTML = `${topbar({ showUser: false })}<div class="empty">Tournoi introuvable ou non public.</div>`;
      bindTopbar(); return;
    }
    if (!t.state || !t.state.step) t.state = defaultState();
    migrateState(t.state);
    STATE.tournament = t;
    STATE.mode = 'public';
    STATE.activeTab = getMonEquipe(slug) ? 'equipe' : 'tournoi';
    renderPublic();
    subscribeToTournament(t.id, fresh => {
      STATE.tournament = fresh;
      if (!fresh.state.step) STATE.tournament.state = defaultState();
      migrateState(STATE.tournament.state);
      const y = window.scrollY;
      renderPublic();
      window.scrollTo(0, y);
    });
  } catch (e) { toast('Erreur : ' + e.message); }
}

function renderPublic() {
  const t = STATE.tournament;
  app.innerHTML = `
    ${topbar({ showUser: false })}
    <div class="public-banner">
      <strong>${escapeHtml(t.name)}</strong> · mis à jour en direct
    </div>
    ${mainTabs()}
    <div id="tab-content"></div>
  `;
  bindTopbar();
  bindMainTabs();
  renderActiveTab();
}

function renderPublicTournoi(container) {
  const s = STATE.tournament.state;

  if (s.step === 'teams' || s.teams.length === 0) {
    container.innerHTML = `
      <div class="card">
        <h3 class="mb-2">Équipes inscrites</h3>
        ${s.teams.length === 0
          ? '<div class="empty">Les inscriptions sont en cours…</div>'
          : s.teams.map((t, i) => `<div class="team"><span><span class="team-num">${i + 1}.</span>${escapeHtml(t)}</span></div>`).join('')
        }
      </div>
    `;
    return;
  }
  if (s.step === 'config') {
    container.innerHTML = `<div class="empty">Tirage des poules imminent…</div>`;
    return;
  }
  if (s.step === 'poules') {
    const fmt = s.config.format;
    container.innerHTML = `
      <div class="card">
        <div class="tiny mb-2">
          <strong>${s.teams.length}</strong> équipes · <strong>${s.poules.length}</strong> poules ·
          <strong>${formatLabel(fmt)}</strong> · <strong>${s.config.nbTerrains}</strong> terrains
        </div>
        <div class="poules-grid">
          ${s.poules.map((p, pi) => renderPouleCard(p, pi)).join('')}
        </div>
      </div>
    `;
    return;
  }
  if (s.step === 'brackets') {
    propagateBracket(s.brPrincipal);
    if (s.brConso) propagateBracket(s.brConso);
    if (s.petiteFinalePrincipal) propagatePetiteFinale(s.brPrincipal, s.petiteFinalePrincipal);
    if (s.petiteFinaleConso) propagatePetiteFinale(s.brConso, s.petiteFinaleConso);
    const finalP = s.brPrincipal[s.brPrincipal.length - 1][0];
    const champ = isMatchDecided(finalP) ? getMatchWinner(finalP) : null;
    const finalC = s.brConso ? s.brConso[s.brConso.length - 1][0] : null;
    const champC = (finalC && isMatchDecided(finalC)) ? getMatchWinner(finalC) : null;

    container.innerHTML = `
      ${champ ? `
        <div class="champion-box">
          <span class="trophy">🏆</span>
          <div>Vainqueur du tournoi</div>
          <div class="name">${escapeHtml(champ)}</div>
          ${champC ? `<div class="tiny mt-2" style="font-family: 'DM Sans', sans-serif;">Vainqueur consolante : <strong>${escapeHtml(champC)}</strong></div>` : ''}
        </div>
      ` : ''}
      <div class="card">
        <div class="bracket-tabs">
          <div class="bracket-tab ${STATE.activeBracket === 'principal' ? 'active' : ''}" data-tab="principal">Tableau principal</div>
          <div class="bracket-tab ${STATE.activeBracket === 'conso' ? 'active' : ''}" data-tab="conso">Consolante</div>
        </div>
        <div id="bracket-principal-pane" style="display: ${STATE.activeBracket === 'principal' ? 'block' : 'none'};">
          ${renderRepechesInfo()}
          ${renderBracket(s.brPrincipal, 'principal')}
          ${renderPetiteFinale(s.petiteFinalePrincipal, 'principal')}
        </div>
        <div id="bracket-conso-pane" style="display: ${STATE.activeBracket === 'conso' ? 'block' : 'none'};">
          ${s.brConso ? `
            ${renderBracket(s.brConso, 'conso')}
            ${renderPetiteFinale(s.petiteFinaleConso, 'conso')}
          ` : '<div class="empty">Pas de consolante.</div>'}
        </div>
        ${renderClassementGlobal()}
      </div>
    `;
    $$('.bracket-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.bracket-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const which = tab.dataset.tab;
        STATE.activeBracket = which;
        $('#bracket-principal-pane').style.display = which === 'principal' ? 'block' : 'none';
        $('#bracket-conso-pane').style.display = which === 'conso' ? 'block' : 'none';
      });
    });
  }
}

// ============== MON ÉQUIPE (vue publique) ==============

// L'équipe choisie est retenue sur le téléphone, tournoi par tournoi
const MON_EQUIPE_KEY_PREFIX = 'lecochonnet_mon_equipe_';

function getMonEquipe(slug) {
  try { return localStorage.getItem(MON_EQUIPE_KEY_PREFIX + slug) || ''; } catch { return ''; }
}

function setMonEquipe(slug, team) {
  try {
    if (team) localStorage.setItem(MON_EQUIPE_KEY_PREFIX + slug, team);
    else localStorage.removeItem(MON_EQUIPE_KEY_PREFIX + slug);
  } catch {}
}

// Tous les matchs d'une équipe, dans l'ordre du tournoi, avec horaire et terrain quand ils sont connus
function teamMatches(s, team) {
  const list = [];
  const concerne = m => m && (m.a === team || m.b === team);
  if (s.planning && s.planning.poules && s.planning.poules.length) {
    s.planning.poules.forEach(slot => slot.matches.forEach(sm => {
      const m = s.poules[sm.pi] && s.poules[sm.pi].matches[sm.mi];
      if (concerne(m)) list.push({ phase: 'Poule ' + s.poules[sm.pi].name, m, time: slot.time, terrain: sm.terrain });
    }));
  } else {
    (s.poules || []).forEach(p => p.matches.forEach(m => {
      if (concerne(m)) list.push({ phase: 'Poule ' + p.name, m });
    }));
  }
  [['principal', s.brPrincipal, s.petiteFinalePrincipal, ''], ['conso', s.brConso, s.petiteFinaleConso, ' (consolante)']]
    .forEach(([key, br, pf, suffixe]) => {
      if (!br) return;
      const labels = roundLabels(br.length);
      br.forEach((round, ri) => round.forEach((m, mi) => {
        // Un match sans adversaire est une qualification d'office : rien à jouer
        if (!concerne(m) || m.a === null || m.b === null) return;
        const sched = findScheduleForBracketMatch(s, key, ri, mi);
        list.push({ phase: labels[ri] + suffixe, m, time: sched && sched.time, terrain: sched && sched.terrain });
      }));
      if (concerne(pf) && pf.a !== null && pf.b !== null) list.push({ phase: 'Petite finale' + suffixe, m: pf });
    });
  return list;
}

function monEquipeMatchHtml(x, team) {
  const m = x.m;
  const nous = m.a === team ? m.scoreA : m.scoreB;
  const eux = m.a === team ? m.scoreB : m.scoreA;
  const adversaire = m.a === team ? m.b : m.a;
  const fait = isMatchDecided(m);
  const resultat = !fait ? '' : nous > eux ? 'gagne' : nous < eux ? 'perdu' : 'nul';
  const resultatLabel = { gagne: 'Gagné', perdu: 'Perdu', nul: 'Nul' }[resultat] || '';
  return `
    <div class="mon-match ${fait ? 'done ' + resultat : ''}">
      <div class="mon-match-quand">
        <span class="planning-time">${escapeHtml(x.time || '—')}</span>
        ${x.terrain ? `<span class="planning-terrain">T${x.terrain}</span>` : ''}
      </div>
      <div class="mon-match-qui">
        <div class="tiny muted">${escapeHtml(x.phase)}</div>
        <div>contre <strong>${escapeHtml(adversaire)}</strong></div>
      </div>
      <div class="mon-match-score">
        ${fait ? `<strong>${nous} – ${eux}</strong><div class="tiny">${resultatLabel}</div>` : '<span class="tiny muted">à jouer</span>'}
      </div>
    </div>
  `;
}

function renderMonEquipeTab(container) {
  const t = STATE.tournament;
  const s = t.state;
  let team = getMonEquipe(t.slug);
  // L'équipe a pu être renommée ou retirée par l'organisateur
  if (team && !s.teams.includes(team)) { setMonEquipe(t.slug, ''); team = ''; }

  const teamsTriees = [...s.teams].sort((a, b) => a.localeCompare(b, 'fr'));
  const choix = `
    <label class="field">
      <span class="label-text">${team ? 'Mon équipe' : 'Choisis ton équipe pour voir tes matchs, tes terrains et tes horaires'}</span>
      <select id="mon-equipe-select">
        <option value="">— Choisir mon équipe —</option>
        ${teamsTriees.map(n => `<option value="${escapeHtml(n)}" ${n === team ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
      </select>
    </label>
  `;

  let corps = '';
  if (s.teams.length === 0) {
    corps = '<div class="empty">Les inscriptions sont en cours…</div>';
  } else if (team) {
    const matchs = teamMatches(s, team);
    if (matchs.length === 0) {
      corps = '<div class="empty">Les poules ne sont pas encore tirées. Tes matchs s’afficheront ici dès le tirage.</div>';
    } else {
      const prochain = matchs.find(x => !isMatchDecided(x.m));
      // Place dans la poule
      let place = '';
      const poule = (s.poules || []).find(p => p.teams.includes(team));
      if (poule) {
        const classement = computeStandings(poule, s.config.format);
        const rang = classement.findIndex(r => r.team === team);
        const st = classement[rang];
        place = `<div class="tiny muted mb-2">Poule ${escapeHtml(poule.name)} : <strong>${rang + 1}<sup>${rang === 0 ? 're' : 'e'}</sup></strong> sur ${poule.teams.length} · ${st.points} pt${st.points > 1 ? 's' : ''} · ${st.wins} victoire${st.wins > 1 ? 's' : ''}</div>`;
      }
      corps = `
        ${prochain ? `
          <div class="mon-prochain">
            <div class="tiny">Prochain match · ${escapeHtml(prochain.phase)}</div>
            <div class="mon-prochain-quand">
              ${prochain.time ? escapeHtml(prochain.time) : 'Horaire bientôt affiché'}${prochain.terrain ? ` · Terrain ${prochain.terrain}` : ''}
            </div>
            <div>contre <strong>${escapeHtml(prochain.m.a === team ? prochain.m.b : prochain.m.a)}</strong></div>
          </div>
        ` : `<div class="mon-prochain fini"><div class="mon-prochain-quand">Plus de match prévu pour l’instant</div><div class="tiny">La suite dépend des résultats : la page se met à jour toute seule.</div></div>`}
        <div class="card">
          <h3 class="mb-2">Tous mes matchs</h3>
          ${place}
          ${matchs.map(x => monEquipeMatchHtml(x, team)).join('')}
        </div>
      `;
    }
  }

  container.innerHTML = `<div class="card">${choix}</div>${corps}`;
  $('#mon-equipe-select').addEventListener('change', e => {
    setMonEquipe(t.slug, e.target.value);
    renderMonEquipeTab(container);
  });
}

// ============== COMPTES (administrateurs et organisateurs) ==============

const ROLE_LABELS = { principal: 'Administrateur principal', admin: 'Administrateur', organisateur: 'Organisateur' };

async function chargerCompte() {
  try { STATE.user = (await appelServeur('/api/moi')).compte; }
  catch { STATE.user = null; }
  STATE.profil = STATE.user;
}

function estAdmin() {
  const p = STATE.profil;
  return !!p && (p.role === 'principal' || p.role === 'admin');
}

function nomAffiche() {
  const p = STATE.profil;
  return p ? (p.nom || p.identifiant) : '';
}

// Mot de passe facile à dicter : boule-4827-terrain
function genererMotDePasse() {
  const mots = ['boule', 'carreau', 'pointe', 'tireur', 'mene', 'terrain', 'cochonnet', 'triplette', 'doublette', 'fanny', 'but', 'palet'];
  const n = new Uint32Array(3);
  crypto.getRandomValues(n);
  return `${mots[n[0] % mots.length]}-${1000 + (n[1] % 9000)}-${mots[n[2] % mots.length]}`;
}

// Appel au serveur du site pour gérer les comptes
function apiComptes(chemin = '', options = {}) {
  return appelServeur('/api/comptes' + chemin, options);
}

// Même règle que le serveur : le principal gère tout le monde sauf lui-même,
// un administrateur gère les organisateurs.
function peutGererCompte(moi, cible) {
  if (moi.id === cible.id) return false;
  if (moi.role === 'principal') return cible.role !== 'principal';
  if (moi.role === 'admin') return cible.role === 'organisateur';
  return false;
}

function montrerIdentifiants(titre, identifiant, motDePasse) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-bg';
  wrap.innerHTML = `
    <div class="modal">
      <h2>${escapeHtml(titre)}</h2>
      <p class="muted tiny">À donner à la personne. Le mot de passe ne sera plus affiché ensuite :
      notez-le ou copiez-le maintenant. Elle pourra le changer dans « Mon mot de passe ».</p>
      <div class="compte-identifiants">
        <div><span class="tiny muted">Adresse</span><strong>${escapeHtml(window.location.origin)}</strong></div>
        <div><span class="tiny muted">Identifiant</span><strong>${escapeHtml(identifiant)}</strong></div>
        <div><span class="tiny muted">Mot de passe</span><strong>${escapeHtml(motDePasse)}</strong></div>
      </div>
      <div class="modal-actions">
        <button class="ghost" id="ids-copier">Copier</button>
        <button class="primary" id="ids-fermer">C'est noté</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelector('#ids-copier').addEventListener('click', async () => {
    const texte = `LeCochonnet\nAdresse : ${window.location.origin}\nIdentifiant : ${identifiant}\nMot de passe : ${motDePasse}`;
    try { await navigator.clipboard.writeText(texte); toast('Copié'); } catch { toast('Copie impossible'); }
  });
  wrap.querySelector('#ids-fermer').addEventListener('click', () => wrap.remove());
}

async function renderComptes() {
  if (!estAdmin()) { navigate('#/'); return; }
  app.innerHTML = `${topbar()}<div class="empty" style="margin-top: 40px;">Chargement…</div>`;
  bindTopbar();
  let liste;
  try { liste = await apiComptes(); }
  catch (e) {
    app.innerHTML = `${topbar()}<div class="card"><h2>Comptes</h2><p style="color: var(--danger);">${escapeHtml(e.message)}</p><a class="btn ghost" href="#/">← Retour</a></div>`;
    bindTopbar(); return;
  }
  const moi = liste.moi;
  const comptes = liste.comptes;
  const ligne = c => `
    <div class="compte-ligne ${c.actif ? '' : 'inactif'}">
      <div class="compte-qui">
        <strong>${escapeHtml(c.nom || c.identifiant)}</strong>
        <div class="tiny muted">${escapeHtml(c.identifiant)} · ${ROLE_LABELS[c.role]}${c.actif ? '' : ' · <strong>désactivé</strong>'}${c.id === moi.id ? ' · c’est vous' : ''}</div>
      </div>
      ${peutGererCompte(moi, c) ? `
        <div class="row tight" style="flex-wrap: wrap;">
          <button class="ghost" data-mdp="${c.id}" data-ident="${escapeHtml(c.identifiant)}">Nouveau mot de passe</button>
          <button class="ghost ${c.actif ? 'danger' : ''}" data-actif="${c.id}" data-valeur="${c.actif ? 'non' : 'oui'}" data-nom="${escapeHtml(c.nom || c.identifiant)}">${c.actif ? 'Désactiver' : 'Réactiver'}</button>
        </div>` : ''}
    </div>
  `;
  const admins = comptes.filter(c => c.role !== 'organisateur');
  const orgas = comptes.filter(c => c.role === 'organisateur');

  app.innerHTML = `
    ${topbar()}
    <div class="row mb-2" style="justify-content: space-between; flex-wrap: wrap; gap: 8px;">
      <h1>Comptes</h1>
      <a class="btn ghost" href="#/">← Tournois</a>
    </div>

    <div class="card">
      <h3 class="mb-2">Créer un compte</h3>
      <div class="compte-form">
        <label class="field"><span class="label-text">Nom (club, comité, personne)</span>
          <input type="text" id="cc-nom" placeholder="Comité des fêtes d'Aunay" maxlength="80" /></label>
        <label class="field"><span class="label-text">Identifiant de connexion</span>
          <input type="text" id="cc-ident" placeholder="comite-aunay" autocapitalize="none" autocomplete="off" spellcheck="false" maxlength="30" /></label>
        <label class="field"><span class="label-text">Type de compte</span>
          <select id="cc-role">
            <option value="organisateur">Organisateur (gère ses tournois)</option>
            ${moi.role === 'principal' ? '<option value="admin">Administrateur (gère tous les tournois et les organisateurs)</option>' : ''}
          </select></label>
        <label class="field"><span class="label-text">Mot de passe</span>
          <div class="row tight"><input type="text" id="cc-mdp" value="${genererMotDePasse()}" autocomplete="off" style="flex: 1;" />
          <button class="ghost" id="cc-autre" title="Proposer un autre mot de passe">↻</button></div></label>
      </div>
      <button class="primary" id="cc-creer">Créer le compte</button>
    </div>

    <div class="card">
      <h3 class="mb-2">Administrateurs</h3>
      ${admins.map(ligne).join('')}
    </div>
    <div class="card">
      <h3 class="mb-2">Organisateurs</h3>
      ${orgas.length ? orgas.map(ligne).join('') : '<div class="empty">Aucun organisateur pour le moment.</div>'}
    </div>
  `;
  bindTopbar();

  // Identifiant proposé à partir du nom
  $('#cc-nom').addEventListener('input', e => {
    const ident = $('#cc-ident');
    if (ident.dataset.touche) return;
    ident.value = slugify(e.target.value).slice(0, 30);
  });
  $('#cc-ident').addEventListener('input', e => { e.target.dataset.touche = '1'; });
  $('#cc-autre').addEventListener('click', () => { $('#cc-mdp').value = genererMotDePasse(); });
  $('#cc-creer').addEventListener('click', async e => {
    const btn = e.currentTarget;
    const identifiant = $('#cc-ident').value.trim().toLowerCase();
    const motDePasse = $('#cc-mdp').value;
    btn.disabled = true;
    try {
      await apiComptes('', { method: 'POST', body: { nom: $('#cc-nom').value.trim(), identifiant, role: $('#cc-role').value, motDePasse } });
      await renderComptes();
      montrerIdentifiants('Compte créé', identifiant, motDePasse);
    } catch (err) { toast(err.message); btn.disabled = false; }
  });

  $$('[data-mdp]').forEach(b => b.addEventListener('click', async () => {
    const motDePasse = genererMotDePasse();
    if (!confirm(`Donner un nouveau mot de passe à « ${b.dataset.ident} » ?\n\nL'ancien ne marchera plus.`)) return;
    try {
      await apiComptes(`/${b.dataset.mdp}/mot-de-passe`, { method: 'POST', body: { motDePasse } });
      montrerIdentifiants('Nouveau mot de passe', b.dataset.ident, motDePasse);
    } catch (err) { toast(err.message); }
  }));

  $$('[data-actif]').forEach(b => b.addEventListener('click', async () => {
    const actif = b.dataset.valeur === 'oui';
    if (!actif && !confirm(`Désactiver « ${b.dataset.nom} » ?\n\nIl ne pourra plus se connecter. Ses tournois restent en place et visibles du public.`)) return;
    try {
      await apiComptes(`/${b.dataset.actif}/actif`, { method: 'POST', body: { actif } });
      toast(actif ? 'Compte réactivé' : 'Compte désactivé');
      renderComptes();
    } catch (err) { toast(err.message); }
  }));
}

function renderMonMotDePasse() {
  if (!STATE.user) { navigate('#/login'); return; }
  app.innerHTML = `
    ${topbar()}
    <div class="auth-container">
      <h2 style="margin-bottom: 4px;">Mon mot de passe</h2>
      <p class="muted tiny mb-2">Au moins 8 caractères.</p>
      <label class="field"><span class="label-text">Nouveau mot de passe</span><input type="password" id="mdp-1" autocomplete="new-password" /></label>
      <label class="field"><span class="label-text">Encore une fois</span><input type="password" id="mdp-2" autocomplete="new-password" /></label>
      <button class="primary" id="mdp-ok" style="width: 100%; justify-content: center;">Changer le mot de passe</button>
      <p class="tiny center mt-2"><a href="#/">← Retour</a></p>
    </div>
  `;
  bindTopbar();
  $('#mdp-ok').addEventListener('click', async () => {
    const a = $('#mdp-1').value, b = $('#mdp-2').value;
    if (a.length < 8) { toast('Au moins 8 caractères'); return; }
    if (a !== b) { toast('Les deux mots de passe sont différents'); return; }
    try { await appelServeur('/api/moi/mot-de-passe', { method: 'POST', body: { motDePasse: a } }); }
    catch (e) { toast('Erreur : ' + e.message); return; }
    toast('Mot de passe changé');
    navigate('#/');
  });
}

// ============== INIT ==============

(async function init() {
  // Bouton « Imprimer le récapitulatif » (présent dans la vue admin et la vue publique)
  document.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('#print-recap');
    if (btn && STATE.tournament && STATE.tournament.state) {
      printDocument('Récapitulatif — ' + STATE.tournament.name, buildPrintableRecap(STATE.tournament.state));
    }
    const btnPoules = e.target.closest && e.target.closest('#print-poule-results');
    if (btnPoules && STATE.tournament && STATE.tournament.state) {
      printDocument('Résultats des poules — ' + STATE.tournament.name, buildPrintablePouleResults(STATE.tournament.state));
    }
  });
  await route();
})();
