/* EMSI Notes : interface web (couche présentation / front-end)
 *
 * Page unique en JavaScript sans dépendance. Toutes les données viennent
 * de l'API par des appels relatifs à /api/... : c'est Nginx qui transmet
 * ces appels au serveur d'application.
 */
"use strict";

const etat = { token: null, user: null };
const $ = (sel, racine = document) => racine.querySelector(sel);
const contenu = $("#contenu");

// Échappement HTML : toute donnée venant de l'API passe par esc() avant affichage
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const fmtNote = n => (n === null || n === undefined) ? "—" : Number(n).toFixed(2).replace(".", ",");
const fmtDate = d => d ? new Date(d.replace(" ", "T")).toLocaleString("fr-FR") : "—";
const libellesRoles = { admin: "Administrateur", enseignant: "Enseignant", etudiant: "Étudiant" };

// ------------------------------------------------------------------ appels API
async function api(chemin, options = {}) {
  const entetes = { "Content-Type": "application/json" };
  if (etat.token) entetes.Authorization = "Bearer " + etat.token;
  let rep;
  try {
    rep = await fetch("/api" + chemin, { ...options, headers: entetes });
  } catch (e) {
    throw new Error("Serveur injoignable (" + e.message + ")");
  }
  majServeurWeb(rep);
  const type = rep.headers.get("Content-Type") || "";
  const donnees = type.includes("json") ? await rep.json() : await rep.text();
  if (rep.status === 401 && etat.token) { deconnexion(); throw new Error("Session expirée"); }
  if (!rep.ok) {
    let msg = (donnees && donnees.erreur) || ("Erreur HTTP " + rep.status);
    if (rep.status === 502 || rep.status === 504) msg = "Erreur " + rep.status + " : le serveur web n'arrive pas à joindre l'API.";
    if (donnees && donnees.trace) msg += "\n\n" + donnees.trace;
    throw new Error(msg);
  }
  return donnees;
}
const envoyer = (chemin, methode, corps) => api(chemin, { method: methode, body: JSON.stringify(corps) });

// Le serveur web ajoute l'en-tête X-Web-Server (nom de la machine Nginx)
function majServeurWeb(rep) {
  const web = rep.headers.get("X-Web-Server");
  if (web) $("#srv-web").textContent = web;
}
async function majPied() {
  try {
    const rep = await fetch("/api/health");
    majServeurWeb(rep);
    const s = await rep.json();
    $("#srv-api").textContent = s.instance || "—";
    $("#srv-base").textContent = s.base || "—";
  } catch { $("#srv-api").textContent = "injoignable"; $("#srv-base").textContent = "?"; }
}

function toast(msg, erreur = false) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast" + (erreur ? " erreur" : ""); t.hidden = false;
  clearTimeout(toast.minuteur); toast.minuteur = setTimeout(() => t.hidden = true, 3500);
}
function afficherErreur(e) {
  contenu.innerHTML = `<h1>Une erreur est survenue</h1><p class="msg-erreur">${esc(e.message)}</p>`;
}

// ------------------------------------------------------------------ connexion
function sauverSession() {
  try { sessionStorage.setItem("emsi-notes", JSON.stringify({ token: etat.token, user: etat.user })); } catch {}
}
function lireSession() {
  try { Object.assign(etat, JSON.parse(sessionStorage.getItem("emsi-notes")) || {}); } catch {}
}
function deconnexion() {
  etat.token = null; etat.user = null;
  try { sessionStorage.removeItem("emsi-notes"); } catch {}
  location.hash = "";
  demarrer();
}

$("#form-connexion").addEventListener("submit", async ev => {
  ev.preventDefault();
  const f = new FormData(ev.target), err = $("#erreur-connexion");
  err.hidden = true;
  try {
    const r = await envoyer("/auth/login", "POST", { login: f.get("login"), password: f.get("password") });
    etat.token = r.token; etat.user = r.user; sauverSession();
    ev.target.reset();
    location.hash = etat.user.role === "etudiant" ? "#/bulletin" : "#/tableau";
    demarrer();
  } catch (e) { err.textContent = e.message; err.hidden = false; }
});
$("#btn-deconnexion").addEventListener("click", deconnexion);

// ------------------------------------------------------------------ menu et routage
const MENU = [
  { route: "tableau", libelle: "Tableau de bord", roles: ["admin", "enseignant"] },
  { route: "bulletin", libelle: "Mon bulletin", roles: ["etudiant"] },
  { route: "annuaire", libelle: "Annuaire des étudiants", roles: ["admin", "enseignant", "etudiant"] },
  { route: "modules", libelle: "Modules et notes", roles: ["admin", "enseignant"] },
  { sep: "Administration", roles: ["admin"] },
  { route: "comptes", libelle: "Comptes", roles: ["admin"] },
  { route: "journal", libelle: "Journal d'audit", roles: ["admin"] },
  { route: "systeme", libelle: "Système", roles: ["admin"] },
  { sep: "Mon compte", roles: ["admin", "enseignant", "etudiant"] },
  { route: "motdepasse", libelle: "Mot de passe", roles: ["admin", "enseignant", "etudiant"] },
];

function dessinerMenu(routeActive) {
  $("#menu").innerHTML = MENU.filter(m => m.roles.includes(etat.user.role)).map(m => m.sep
    ? `<div class="sep">${m.sep}</div>`
    : `<a href="#/${m.route}" class="${m.route === routeActive ? "actif" : ""}">${m.libelle}</a>`).join("");
}

const VUES = {};
async function router() {
  if (!etat.user) return;
  const [route = "", param] = location.hash.replace(/^#\//, "").split("/");
  const defaut = etat.user.role === "etudiant" ? "bulletin" : "tableau";
  const vue = VUES[route] ? route : defaut;
  dessinerMenu(vue === "notes" ? "modules" : vue === "fiche" ? "annuaire" : vue);
  contenu.innerHTML = `<p class="vide">Chargement…</p>`;
  try { await VUES[vue](param); } catch (e) { afficherErreur(e); }
}
window.addEventListener("hashchange", router);

function demarrer() {
  lireSession();
  const connecte = !!etat.token;
  $("#ecran-connexion").hidden = connecte;
  $("#ecran-app").hidden = !connecte;
  if (!connecte) return;
  $("#nom-utilisateur").textContent = etat.user.nom_complet;
  $("#role-utilisateur").textContent = libellesRoles[etat.user.role];
  majPied();
  router();
}

// ------------------------------------------------------------------ fenêtre modale
function modale(titre, champsHtml, surValider) {
  const d = $("#modale"), f = $("#form-modale");
  f.innerHTML = `<h2>${esc(titre)}</h2>${champsHtml}<p class="msg-erreur" hidden></p>
    <div class="boutons"><button class="btn" value="annuler" formnovalidate>Annuler</button>
    <button class="btn principal" value="ok">Enregistrer</button></div>`;
  f.onsubmit = async ev => {
    if (ev.submitter && ev.submitter.value === "annuler") return;
    ev.preventDefault();
    try { await surValider(Object.fromEntries(new FormData(f))); d.close(); router(); }
    catch (e) { const m = $(".msg-erreur", f); m.textContent = e.message; m.hidden = false; }
  };
  d.showModal();
}
const champ = (nom, libelle, val = "", type = "text", requis = true) =>
  `<label>${libelle}<input name="${nom}" type="${type}" value="${esc(val)}" ${requis ? "required" : ""}></label>`;

// ------------------------------------------------------------------ vues
VUES.tableau = async () => {
  const s = await api("/stats");
  contenu.innerHTML = `<h1>Tableau de bord</h1>
    <p class="sous-titre">Vue d'ensemble de la promotion. Un module est validé à partir de ${s.seuil}/20.</p>
    <div class="cartes">
      <div class="carte"><div class="valeur">${s.etudiants}</div><div class="libelle">étudiants inscrits</div></div>
      <div class="carte"><div class="valeur">${s.modules}</div><div class="libelle">modules</div></div>
      <div class="carte"><div class="valeur">${s.notes}</div><div class="libelle">notes saisies</div></div>
      <div class="carte"><div class="valeur">${fmtNote(s.moyenne_generale)}</div><div class="libelle">moyenne générale /20</div></div>
    </div>
    <h2>Résultats par module</h2>
    <div class="defile"><table class="tableau"><thead><tr><th>Code</th><th>Module</th><th class="num">Notes</th>
      <th class="num">Moyenne</th><th>Taux de réussite</th></tr></thead><tbody>
      ${s.par_module.map(m => `<tr><td class="mono">${esc(m.code)}</td><td>${esc(m.intitule)}</td>
        <td class="num">${m.nb_notes}</td><td class="num">${fmtNote(m.moyenne)}</td>
        <td>${m.taux_reussite === null ? "—" : `<div style="display:flex;gap:8px;align-items:center">
          <div class="jauge" style="flex:1"><span style="width:${m.taux_reussite}%"></span></div>${m.taux_reussite} %</div>`}</td></tr>`).join("")}
    </tbody></table></div>`;
};

VUES.annuaire = async () => {
  const admin = etat.user.role === "admin", lecteur = etat.user.role !== "etudiant";
  contenu.innerHTML = `<h1>Annuaire des étudiants</h1>
    <p class="sous-titre">Recherchez un étudiant par son nom ou son prénom.</p>
    <form class="barre-outils" id="form-recherche">
      <input type="search" name="q" placeholder="Nom ou prénom…" autocomplete="off">
      <button class="btn principal">Rechercher</button>
      ${admin ? `<button type="button" class="btn" id="btn-ajout">+ Nouvel étudiant</button>` : ""}
    </form>
    <div id="resultats" class="defile"></div>`;
  const charger = async q => {
    const zone = $("#resultats");
    try {
      const lignes = await api("/etudiants?q=" + encodeURIComponent(q));
      zone.innerHTML = lignes.length === 0 ? `<p class="vide">Aucun résultat.</p>` :
        `<table class="tableau"><thead><tr><th>Matricule</th><th>Nom</th><th>Prénom</th><th>Filière</th>
         ${lecteur ? "<th></th>" : ""}</tr></thead><tbody>
         ${lignes.map(e => `<tr><td class="mono">${esc(e.matricule)}</td><td>${esc(e.nom)}</td><td>${esc(e.prenom)}</td>
           <td>${esc(e.filiere)}</td>${lecteur ? `<td class="actions"><a class="btn petit" href="#/fiche/${esc(e.id)}">Fiche</a></td>` : ""}</tr>`).join("")}
         </tbody></table><p class="sous-titre" style="margin-top:8px">${lignes.length} résultat(s)</p>`;
    } catch (e) { zone.innerHTML = `<p class="msg-erreur">${esc(e.message)}</p>`; }
  };
  $("#form-recherche").addEventListener("submit", ev => { ev.preventDefault(); charger(ev.target.q.value); });
  if (admin) $("#btn-ajout").addEventListener("click", () => formulaireEtudiant());
  await charger("");
};

function formulaireEtudiant(e = {}) {
  modale(e.id ? "Modifier l'étudiant" : "Nouvel étudiant", `
    <div class="grille2">${champ("matricule", "Matricule", e.matricule)}${champ("annee", "Année", e.annee || 4, "number")}</div>
    <div class="grille2">${champ("nom", "Nom", e.nom)}${champ("prenom", "Prénom", e.prenom)}</div>
    ${champ("email", "E-mail", e.email, "email")}
    <div class="grille2">${champ("telephone", "Téléphone", e.telephone, "tel", false)}${champ("date_naissance", "Date de naissance", e.date_naissance, "date", false)}</div>
    ${champ("filiere", "Filière", e.filiere || "Informatique et Réseaux")}`,
    async d => {
      if (e.id) await envoyer("/etudiants/" + e.id, "PUT", d); else await envoyer("/etudiants", "POST", d);
      toast("Étudiant enregistré");
    });
}

VUES.fiche = async id => {
  const [e, b] = await Promise.all([api("/etudiants/" + id), api("/bulletin/" + id)]);
  const admin = etat.user.role === "admin";
  contenu.innerHTML = `<h1>${esc(e.prenom)} ${esc(e.nom)}</h1>
    <p class="sous-titre"><span class="mono">${esc(e.matricule)}</span> · ${esc(e.filiere)} · ${esc(e.annee)}e année</p>
    <div class="barre-outils"><a class="btn" href="#/annuaire">← Annuaire</a>
      ${admin ? `<button class="btn" id="btn-modif">Modifier</button><button class="btn danger" id="btn-suppr">Supprimer</button>` : ""}</div>
    <dl class="fiche"><dt>E-mail</dt><dd>${esc(e.email)}</dd><dt>Téléphone</dt><dd>${esc(e.telephone || "—")}</dd>
      <dt>Date de naissance</dt><dd>${esc(e.date_naissance || "—")}</dd></dl>
    ${htmlBulletin(b)}`;
  if (admin) {
    $("#btn-modif").addEventListener("click", () => formulaireEtudiant(e));
    $("#btn-suppr").addEventListener("click", async () => {
      if (!confirm(`Supprimer ${e.prenom} ${e.nom} et toutes ses notes ?`)) return;
      try { await api("/etudiants/" + e.id, { method: "DELETE" }); toast("Étudiant supprimé"); location.hash = "#/annuaire"; }
      catch (err) { toast(err.message, true); }
    });
  }
};

function htmlBulletin(b) {
  const couleur = b.moyenne === null ? "" : b.moyenne >= b.seuil ? "color:var(--vert)" : "color:var(--rouge)";
  return `<h2>Relevé de notes</h2>
    <div class="cartes" style="margin-bottom:14px"><div class="carte"><div class="libelle">Moyenne pondérée</div>
      <div class="moyenne" style="${couleur}">${fmtNote(b.moyenne)}<small style="font-size:16px;color:var(--gris)"> /20</small></div>
      <div class="libelle">${b.complet ? "Relevé complet" : "Relevé provisoire : certains modules ne sont pas encore notés"}</div></div></div>
    <div class="defile"><table class="tableau"><thead><tr><th>Semestre</th><th>Code</th><th>Module</th><th class="num">Coef.</th>
      <th class="num">Note /20</th><th>Résultat</th></tr></thead><tbody>
      ${b.modules.map(m => `<tr><td>${esc(m.semestre)}</td><td class="mono">${esc(m.code)}</td><td>${esc(m.intitule)}</td>
        <td class="num">${m.coefficient}</td><td class="num">${fmtNote(m.note)}</td>
        <td>${m.resultat === null ? `<span class="badge gris">En attente</span>` :
          m.resultat === "Validé" ? `<span class="badge">Validé</span>` : `<span class="badge rouge">Non validé</span>`}</td></tr>`).join("")}
    </tbody></table></div>`;
}

VUES.bulletin = async () => {
  if (!etat.user.etudiant_id) { contenu.innerHTML = `<p class="vide">Ce compte n'est lié à aucun dossier étudiant.</p>`; return; }
  const b = await api("/bulletin/" + etat.user.etudiant_id);
  contenu.innerHTML = `<h1>Mon bulletin</h1>
    <p class="sous-titre">${esc(b.etudiant.prenom)} ${esc(b.etudiant.nom)} · <span class="mono">${esc(b.etudiant.matricule)}</span> · ${esc(b.etudiant.filiere)}</p>
    ${htmlBulletin(b)}`;
};

VUES.modules = async () => {
  const admin = etat.user.role === "admin";
  const [mods, profs] = await Promise.all([api("/modules"), admin ? api("/enseignants") : Promise.resolve([])]);
  contenu.innerHTML = `<h1>Modules et notes</h1>
    <p class="sous-titre">${admin ? "Gérez les modules et consultez toutes les notes." : "Saisissez les notes des modules dont vous êtes responsable."}</p>
    ${admin ? `<div class="barre-outils"><button class="btn principal" id="btn-ajout">+ Nouveau module</button></div>` : ""}
    <div class="defile"><table class="tableau"><thead><tr><th>Semestre</th><th>Code</th><th>Intitulé</th><th class="num">Coef.</th>
      <th>Enseignant</th><th></th></tr></thead><tbody>
      ${mods.map(m => {
        const peutNoter = admin || m.enseignant_id === etat.user.id;
        return `<tr><td>${esc(m.semestre)}</td><td class="mono">${esc(m.code)}</td><td>${esc(m.intitule)}</td>
          <td class="num">${m.coefficient}</td><td>${esc(m.enseignant || "—")}</td>
          <td class="actions">${peutNoter ? `<a class="btn petit" href="#/notes/${m.id}">Notes</a>` : ""}
          ${admin ? `<button class="btn petit" data-modif="${m.id}">Modifier</button>
                     <button class="btn petit danger" data-suppr="${m.id}">Supprimer</button>` : ""}</td></tr>`;
      }).join("")}
    </tbody></table></div>`;
  if (!admin) return;
  const formulaire = (m = {}) => modale(m.id ? "Modifier le module" : "Nouveau module", `
    <div class="grille2">${champ("code", "Code", m.code)}${champ("semestre", "Semestre", m.semestre || "S7")}</div>
    ${champ("intitule", "Intitulé", m.intitule)}
    <div class="grille2">${champ("coefficient", "Coefficient", m.coefficient || 1, "number")}
    <label>Enseignant<select name="enseignant_id"><option value="">—</option>
      ${profs.map(p => `<option value="${p.id}" ${p.id === m.enseignant_id ? "selected" : ""}>${esc(p.nom_complet)}</option>`).join("")}
    </select></label></div>`,
    async d => { if (m.id) await envoyer("/modules/" + m.id, "PUT", d); else await envoyer("/modules", "POST", d); toast("Module enregistré"); });
  $("#btn-ajout").addEventListener("click", () => formulaire());
  contenu.querySelectorAll("[data-modif]").forEach(b => b.addEventListener("click", () =>
    formulaire(mods.find(m => m.id === Number(b.dataset.modif)))));
  contenu.querySelectorAll("[data-suppr]").forEach(b => b.addEventListener("click", async () => {
    const m = mods.find(x => x.id === Number(b.dataset.suppr));
    if (!confirm(`Supprimer le module ${m.code} et toutes ses notes ?`)) return;
    try { await api("/modules/" + m.id, { method: "DELETE" }); toast("Module supprimé"); router(); }
    catch (e) { toast(e.message, true); }
  }));
};

VUES.notes = async id => {
  const r = await api(`/modules/${id}/notes`), m = r.module;
  contenu.innerHTML = `<h1>${esc(m.code)} · ${esc(m.intitule)}</h1>
    <p class="sous-titre">Coefficient ${m.coefficient} · semestre ${esc(m.semestre)}. Laissez une case vide pour retirer une note.</p>
    <div class="barre-outils"><a class="btn" href="#/modules">← Modules</a>
      <button class="btn principal" id="btn-enreg">Enregistrer les notes</button>
      <button class="btn" id="btn-csv">Exporter en CSV</button></div>
    <div class="defile"><table class="tableau"><thead><tr><th>Matricule</th><th>Nom</th><th>Prénom</th>
      <th class="num">Note /20</th><th>Dernière saisie</th></tr></thead><tbody>
      ${r.notes.map(n => `<tr><td class="mono">${esc(n.matricule)}</td><td>${esc(n.nom)}</td><td>${esc(n.prenom)}</td>
        <td class="num"><input class="note" data-etudiant="${n.etudiant_id}" inputmode="decimal"
          value="${n.note === null ? "" : String(n.note).replace(".", ",")}"></td>
        <td>${fmtDate(n.date_saisie)}</td></tr>`).join("")}
    </tbody></table></div>`;
  $("#btn-enreg").addEventListener("click", async () => {
    const saisies = [...contenu.querySelectorAll("input.note")].map(i => ({ etudiant_id: Number(i.dataset.etudiant), note: i.value.trim() }));
    try { const res = await envoyer(`/modules/${id}/notes`, "PUT", saisies); toast(res.enregistrees + " note(s) enregistrée(s)"); router(); }
    catch (e) { toast(e.message, true); }
  });
  $("#btn-csv").addEventListener("click", async () => {
    try {
      const rep = await fetch(`/api/modules/${id}/notes.csv`, { headers: { Authorization: "Bearer " + etat.token } });
      if (!rep.ok) throw new Error("Export impossible (HTTP " + rep.status + ")");
      const lien = document.createElement("a");
      lien.href = URL.createObjectURL(await rep.blob()); lien.download = `notes-${m.code}.csv`; lien.click();
    } catch (e) { toast(e.message, true); }
  });
};

VUES.comptes = async () => {
  const comptes = await api("/utilisateurs");
  contenu.innerHTML = `<h1>Comptes</h1>
    <p class="sous-titre">Comptes de connexion et rôles. Un compte désactivé ne peut plus se connecter.</p>
    <div class="barre-outils"><button class="btn principal" id="btn-ajout">+ Nouveau compte</button></div>
    <div class="defile"><table class="tableau"><thead><tr><th>Identifiant</th><th>Nom</th><th>Rôle</th>
      <th>Dernière connexion</th><th>État</th><th></th></tr></thead><tbody>
      ${comptes.map(c => `<tr><td class="mono">${esc(c.login)}</td><td>${esc(c.nom_complet)}</td><td>${libellesRoles[c.role]}</td>
        <td>${fmtDate(c.derniere_connexion)}</td>
        <td>${c.actif ? `<span class="badge">Actif</span>` : `<span class="badge rouge">Désactivé</span>`}</td>
        <td class="actions">${c.id === etat.user.id ? "" :
          `<button class="btn petit" data-id="${c.id}" data-actif="${c.actif ? 0 : 1}">${c.actif ? "Désactiver" : "Activer"}</button>`}</td></tr>`).join("")}
    </tbody></table></div>`;
  contenu.querySelectorAll("[data-id]").forEach(b => b.addEventListener("click", async () => {
    try { await envoyer(`/utilisateurs/${b.dataset.id}/actif`, "PUT", { actif: b.dataset.actif === "1" }); router(); }
    catch (e) { toast(e.message, true); }
  }));
  $("#btn-ajout").addEventListener("click", () => modale("Nouveau compte", `
    <div class="grille2">${champ("login", "Identifiant")}<label>Rôle<select name="role">
      <option value="enseignant">Enseignant</option><option value="etudiant">Étudiant</option><option value="admin">Administrateur</option></select></label></div>
    ${champ("nom_complet", "Nom complet")}
    ${champ("password", "Mot de passe initial (10 caractères minimum)", "", "password")}
    ${champ("etudiant_id", "N° de dossier étudiant (comptes étudiants uniquement)", "", "number", false)}`,
    async d => { await envoyer("/utilisateurs", "POST", d); toast("Compte créé"); }));
};

VUES.journal = async () => {
  const lignes = await api("/journal");
  const sensibles = ["ECHEC_CONNEXION", "ACCES_REFUSE", "SUPPRESSION_ETUDIANT", "SUPPRESSION_MODULE", "DESACTIVATION_COMPTE"];
  contenu.innerHTML = `<h1>Journal d'audit</h1>
    <p class="sous-titre">Les 200 dernières actions enregistrées par l'application, avec l'adresse IP d'origine.</p>
    <div class="defile"><table class="tableau"><thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Détail</th><th>Adresse IP</th></tr></thead><tbody>
      ${lignes.map(l => `<tr><td>${fmtDate(l.date_action)}</td><td class="mono">${esc(l.login || "—")}</td>
        <td><span class="badge ${sensibles.includes(l.action) ? "rouge" : "gris"}">${esc(l.action)}</span></td>
        <td class="mono">${esc(l.detail || "")}</td><td class="mono">${esc(l.adresse_ip || "")}</td></tr>`).join("")}
    </tbody></table></div>`;
};

VUES.systeme = async () => {
  const i = await api("/info");
  const oui = v => v ? `<span class="badge rouge">activé</span>` : `<span class="badge">désactivé</span>`;
  contenu.innerHTML = `<h1>Système</h1>
    <p class="sous-titre">Informations techniques sur le déploiement en cours.</p>
    <dl class="fiche">
      <dt>Serveur web (Nginx)</dt><dd class="mono">${esc($("#srv-web").textContent)}</dd>
      <dt>Serveur API</dt><dd class="mono">${esc(i.instance_api)}</dd>
      <dt>Base de données</dt><dd class="mono">${esc(i.base)}</dd>
      <dt>Mode vulnérable (TP)</dt><dd>${oui(i.mode_vulnerable)}</dd>
      <dt>Mode debug</dt><dd>${oui(i.mode_debug)}</dd>
      <dt>Version</dt><dd>${esc(i.version)}</dd>
    </dl>`;
};

VUES.motdepasse = async () => {
  contenu.innerHTML = `<h1>Changer mon mot de passe</h1>
    <p class="sous-titre">Choisissez un mot de passe d'au moins 10 caractères.</p>
    <form id="form-mdp" class="carte" style="max-width:420px;display:grid;gap:12px">
      ${champ("actuel", "Mot de passe actuel", "", "password")}${champ("nouveau", "Nouveau mot de passe", "", "password")}
      ${champ("confirmation", "Confirmation", "", "password")}
      <button class="btn principal">Modifier</button></form>`;
  $("#form-mdp").addEventListener("submit", async ev => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target));
    if (d.nouveau !== d.confirmation) { toast("La confirmation ne correspond pas", true); return; }
    try { await envoyer("/auth/password", "POST", d); toast("Mot de passe modifié"); ev.target.reset(); }
    catch (e) { toast(e.message, true); }
  });
};

demarrer();
