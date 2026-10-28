# -*- coding: utf-8 -*-
"""
EMSI Notes - API (couche application / back-end)

Application pédagogique de gestion de la scolarité : étudiants, modules,
notes, bulletins, comptes et journal d'audit.

Toute la configuration est lue dans des variables d'environnement
(fichier emsi-notes.env chargé par systemd) : aucun mot de passe n'est
écrit dans ce code.

    DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD   connexion à la base
    SECRET_KEY        clé de signature des jetons de connexion
    MODE_VULNERABLE   1 = recherche de l'annuaire volontairement injectable (TP)
    MODE_DEBUG        1 = messages d'erreur détaillés renvoyés au client
"""
import csv
import io
import os
import socket
import traceback
from datetime import date, datetime
from decimal import Decimal
from functools import wraps

import pymysql
import pymysql.cursors
from flask import Flask, Response, g, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

VERSION = "1.0"
SEUIL_VALIDATION = 10      # moyenne minimale pour valider un module (sur 20)
DUREE_JETON = 8 * 3600     # un jeton de connexion reste valable 8 heures


def env_bool(nom):
    return os.environ.get(nom, "0").strip().lower() in ("1", "true", "oui", "yes")


CONFIG = {
    "DB_HOST": os.environ.get("DB_HOST", "localhost"),
    "DB_PORT": int(os.environ.get("DB_PORT", "3306")),
    "DB_NAME": os.environ.get("DB_NAME", "emsi_notes"),
    "DB_USER": os.environ.get("DB_USER", "emsi_app"),
    "DB_PASSWORD": os.environ.get("DB_PASSWORD", ""),
    "SECRET_KEY": os.environ.get("SECRET_KEY", ""),
    "MODE_VULNERABLE": env_bool("MODE_VULNERABLE"),
    "MODE_DEBUG": env_bool("MODE_DEBUG"),
}

if not CONFIG["SECRET_KEY"]:
    raise SystemExit("SECRET_KEY absente : renseignez-la dans le fichier emsi-notes.env")

app = Flask(__name__)
app.json.ensure_ascii = False
app.json.sort_keys = False
jetons = URLSafeTimedSerializer(CONFIG["SECRET_KEY"], salt="emsi-notes-auth")


# ---------------------------------------------------------------------------
# Accès à la base de données
# ---------------------------------------------------------------------------
def db():
    """Ouvre (une fois par requête) la connexion à MySQL."""
    if "db" not in g:
        g.db = pymysql.connect(
            host=CONFIG["DB_HOST"], port=CONFIG["DB_PORT"],
            user=CONFIG["DB_USER"], password=CONFIG["DB_PASSWORD"],
            database=CONFIG["DB_NAME"], charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=5, autocommit=True,
        )
    return g.db


@app.teardown_appcontext
def fermer_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def requete(sql, params=None, une=False):
    """Exécute une requête paramétrée et renvoie les lignes (ou une seule)."""
    with db().cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone() if une else cur.fetchall()


def executer(sql, params=None):
    with db().cursor() as cur:
        cur.execute(sql, params)
        return cur.lastrowid


def json_propre(valeur):
    """Convertit les types MySQL (Decimal, date) en types JSON."""
    if isinstance(valeur, list):
        return [json_propre(v) for v in valeur]
    if isinstance(valeur, dict):
        return {k: json_propre(v) for k, v in valeur.items()}
    if isinstance(valeur, Decimal):
        return float(valeur)
    if isinstance(valeur, (date, datetime)):
        return valeur.isoformat(sep=" ") if isinstance(valeur, datetime) else valeur.isoformat()
    return valeur


def ok(donnees=None, code=200):
    return jsonify(json_propre(donnees)), code


def erreur(message, code=400):
    return jsonify({"erreur": message}), code


def adresse_client():
    # Derrière Nginx (et l'ALB), l'adresse réelle est transmise dans X-Forwarded-For
    transmise = request.headers.get("X-Forwarded-For", "")
    return transmise.split(",")[0].strip() if transmise else request.remote_addr


def journaliser(action, detail="", login=None):
    try:
        executer("INSERT INTO journal (login, action, detail, adresse_ip) VALUES (%s, %s, %s, %s)",
                 (login or getattr(g, "user", {}).get("login"), action, detail[:255], adresse_client()))
    except Exception:
        pass  # le journal ne doit jamais bloquer l'application


# ---------------------------------------------------------------------------
# Authentification et contrôle d'accès par rôle
# ---------------------------------------------------------------------------
def connexion_requise(*roles):
    """Décorateur : exige un jeton valide et, si précisé, l'un des rôles donnés."""
    def decorateur(vue):
        @wraps(vue)
        def enveloppe(*args, **kwargs):
            entete = request.headers.get("Authorization", "")
            if not entete.startswith("Bearer "):
                return erreur("Connexion requise", 401)
            try:
                uid = jetons.loads(entete[7:], max_age=DUREE_JETON)
            except SignatureExpired:
                return erreur("Session expirée, reconnectez-vous", 401)
            except BadSignature:
                return erreur("Jeton invalide", 401)
            user = requete("SELECT id, login, nom_complet, role, etudiant_id, actif "
                           "FROM utilisateurs WHERE id = %s", (uid,), une=True)
            if not user or not user["actif"]:
                return erreur("Compte inexistant ou désactivé", 401)
            if roles and user["role"] not in roles:
                return erreur("Accès refusé pour le rôle " + user["role"], 403)
            g.user = user
            return vue(*args, **kwargs)
        return enveloppe
    return decorateur


@app.post("/api/auth/login")
def login():
    corps = request.get_json(silent=True) or {}
    identifiant = str(corps.get("login", "")).strip()
    mot_de_passe = str(corps.get("password", ""))
    user = requete("SELECT * FROM utilisateurs WHERE login = %s", (identifiant,), une=True)
    if not user or not user["actif"] or not check_password_hash(user["mot_de_passe"], mot_de_passe):
        journaliser("ECHEC_CONNEXION", "Identifiant tenté : " + identifiant, login=identifiant)
        return erreur("Identifiant ou mot de passe incorrect", 401)
    executer("UPDATE utilisateurs SET derniere_connexion = NOW() WHERE id = %s", (user["id"],))
    journaliser("CONNEXION", "", login=user["login"])
    return ok({
        "token": jetons.dumps(user["id"]),
        "user": {k: user[k] for k in ("id", "login", "nom_complet", "role", "etudiant_id")},
    })


@app.get("/api/auth/me")
@connexion_requise()
def moi():
    return ok({k: g.user[k] for k in ("id", "login", "nom_complet", "role", "etudiant_id")})


@app.post("/api/auth/password")
@connexion_requise()
def changer_mot_de_passe():
    corps = request.get_json(silent=True) or {}
    actuel, nouveau = str(corps.get("actuel", "")), str(corps.get("nouveau", ""))
    user = requete("SELECT mot_de_passe FROM utilisateurs WHERE id = %s", (g.user["id"],), une=True)
    if not check_password_hash(user["mot_de_passe"], actuel):
        return erreur("Mot de passe actuel incorrect", 403)
    if len(nouveau) < 10:
        return erreur("Le nouveau mot de passe doit contenir au moins 10 caractères")
    executer("UPDATE utilisateurs SET mot_de_passe = %s WHERE id = %s",
             (generate_password_hash(nouveau, method="pbkdf2:sha256:600000"), g.user["id"]))
    journaliser("CHANGEMENT_MDP")
    return ok({"message": "Mot de passe modifié"})


# ---------------------------------------------------------------------------
# Supervision : santé du service et identité de l'instance
# ---------------------------------------------------------------------------
@app.get("/api/health")
def sante():
    etat = {"service": "emsi-notes-api", "version": VERSION,
            "instance": socket.gethostname(), "base": "ok"}
    try:
        requete("SELECT 1")
    except Exception as exc:
        etat["base"] = "injoignable"
        if CONFIG["MODE_DEBUG"]:
            etat["detail"] = str(exc)
        return ok(etat, 503)
    return ok(etat)


@app.get("/api/info")
@connexion_requise("admin")
def info():
    """Informations techniques visibles par l'administrateur uniquement."""
    return ok({
        "instance_api": socket.gethostname(),
        "base": "%s:%s/%s" % (CONFIG["DB_HOST"], CONFIG["DB_PORT"], CONFIG["DB_NAME"]),
        "mode_vulnerable": CONFIG["MODE_VULNERABLE"],
        "mode_debug": CONFIG["MODE_DEBUG"],
        "version": VERSION,
    })


# ---------------------------------------------------------------------------
# Tableau de bord
# ---------------------------------------------------------------------------
@app.get("/api/stats")
@connexion_requise("admin", "enseignant")
def statistiques():
    totaux = requete("""SELECT (SELECT COUNT(*) FROM etudiants) AS etudiants,
                               (SELECT COUNT(*) FROM modules)   AS modules,
                               (SELECT COUNT(*) FROM notes)     AS notes,
                               (SELECT ROUND(AVG(note), 2) FROM notes) AS moyenne_generale""", une=True)
    par_module = requete("""SELECT m.id, m.code, m.intitule, COUNT(n.id) AS nb_notes,
                                   ROUND(AVG(n.note), 2) AS moyenne,
                                   SUM(n.note >= %s) AS valides
                            FROM modules m LEFT JOIN notes n ON n.module_id = m.id
                            GROUP BY m.id ORDER BY m.code""", (SEUIL_VALIDATION,))
    for m in par_module:
        m["taux_reussite"] = round(100 * float(m["valides"] or 0) / m["nb_notes"]) if m["nb_notes"] else None
    totaux["par_module"] = par_module
    totaux["seuil"] = SEUIL_VALIDATION
    return ok(totaux)


# ---------------------------------------------------------------------------
# Étudiants
# ---------------------------------------------------------------------------
CHAMPS_ETUDIANT = ("matricule", "nom", "prenom", "email", "telephone", "date_naissance", "filiere", "annee")


@app.get("/api/etudiants")
@connexion_requise()
def annuaire():
    """Annuaire des étudiants, accessible à tout utilisateur connecté.
    Paramètre q : recherche par nom ou prénom."""
    q = request.args.get("q", "").strip()
    if CONFIG["MODE_VULNERABLE"]:
        # !!! VERSION VOLONTAIREMENT VULNÉRABLE (TP) !!!
        # La saisie de l'utilisateur est collée directement dans la requête SQL :
        # un attaquant peut modifier la requête (injection SQL).
        sql = ("SELECT id, matricule, nom, prenom, filiere FROM etudiants "
               "WHERE nom LIKE '%" + q + "%' OR prenom LIKE '%" + q + "%' ORDER BY nom")
        lignes = requete(sql)
    else:
        # Version corrigée : requête paramétrée, la saisie reste une simple donnée.
        motif = "%" + q + "%"
        lignes = requete("SELECT id, matricule, nom, prenom, filiere FROM etudiants "
                         "WHERE nom LIKE %s OR prenom LIKE %s ORDER BY nom", (motif, motif))
    if q:
        journaliser("RECHERCHE_ANNUAIRE", q)
    return ok(lignes)


@app.get("/api/etudiants/<int:eid>")
@connexion_requise("admin", "enseignant", "etudiant")
def fiche_etudiant(eid):
    if g.user["role"] == "etudiant" and g.user["etudiant_id"] != eid:
        return erreur("Vous ne pouvez consulter que votre propre fiche", 403)
    e = requete("SELECT * FROM etudiants WHERE id = %s", (eid,), une=True)
    return ok(e) if e else erreur("Étudiant introuvable", 404)


def lire_etudiant(corps):
    donnees = {c: (str(corps.get(c, "")).strip() or None) for c in CHAMPS_ETUDIANT}
    for obligatoire in ("matricule", "nom", "prenom", "email", "filiere", "annee"):
        if not donnees[obligatoire]:
            raise ValueError("Champ obligatoire manquant : " + obligatoire)
    return donnees


@app.post("/api/etudiants")
@connexion_requise("admin")
def creer_etudiant():
    try:
        d = lire_etudiant(request.get_json(silent=True) or {})
        nouvel_id = executer("INSERT INTO etudiants (" + ", ".join(CHAMPS_ETUDIANT) + ") VALUES ("
                             + ", ".join(["%s"] * len(CHAMPS_ETUDIANT)) + ")",
                             tuple(d[c] for c in CHAMPS_ETUDIANT))
    except ValueError as exc:
        return erreur(str(exc))
    except pymysql.err.IntegrityError:
        return erreur("Ce matricule existe déjà", 409)
    journaliser("CREATION_ETUDIANT", d["matricule"])
    return ok({"id": nouvel_id}, 201)


@app.put("/api/etudiants/<int:eid>")
@connexion_requise("admin")
def modifier_etudiant(eid):
    try:
        d = lire_etudiant(request.get_json(silent=True) or {})
        executer("UPDATE etudiants SET " + ", ".join(c + " = %s" for c in CHAMPS_ETUDIANT) + " WHERE id = %s",
                 tuple(d[c] for c in CHAMPS_ETUDIANT) + (eid,))
    except ValueError as exc:
        return erreur(str(exc))
    except pymysql.err.IntegrityError:
        return erreur("Ce matricule existe déjà", 409)
    journaliser("MODIFICATION_ETUDIANT", d["matricule"])
    return ok({"id": eid})


@app.delete("/api/etudiants/<int:eid>")
@connexion_requise("admin")
def supprimer_etudiant(eid):
    e = requete("SELECT matricule FROM etudiants WHERE id = %s", (eid,), une=True)
    if not e:
        return erreur("Étudiant introuvable", 404)
    executer("DELETE FROM etudiants WHERE id = %s", (eid,))
    journaliser("SUPPRESSION_ETUDIANT", e["matricule"])
    return ok({"id": eid})


# ---------------------------------------------------------------------------
# Modules
# ---------------------------------------------------------------------------
@app.get("/api/modules")
@connexion_requise()
def liste_modules():
    return ok(requete("""SELECT m.id, m.code, m.intitule, m.coefficient, m.semestre, m.enseignant_id,
                                u.nom_complet AS enseignant
                         FROM modules m LEFT JOIN utilisateurs u ON u.id = m.enseignant_id
                         ORDER BY m.semestre, m.code"""))


def lire_module(corps):
    d = {c: str(corps.get(c, "")).strip() for c in ("code", "intitule", "coefficient", "semestre", "enseignant_id")}
    if not d["code"] or not d["intitule"] or not d["semestre"]:
        raise ValueError("Code, intitulé et semestre sont obligatoires")
    d["coefficient"] = int(d["coefficient"] or 1)
    d["enseignant_id"] = int(d["enseignant_id"]) if d["enseignant_id"] else None
    return d


@app.post("/api/modules")
@connexion_requise("admin")
def creer_module():
    try:
        d = lire_module(request.get_json(silent=True) or {})
        nouvel_id = executer("INSERT INTO modules (code, intitule, coefficient, semestre, enseignant_id) "
                             "VALUES (%s, %s, %s, %s, %s)",
                             (d["code"], d["intitule"], d["coefficient"], d["semestre"], d["enseignant_id"]))
    except ValueError as exc:
        return erreur(str(exc))
    except pymysql.err.IntegrityError:
        return erreur("Ce code de module existe déjà", 409)
    journaliser("CREATION_MODULE", d["code"])
    return ok({"id": nouvel_id}, 201)


@app.put("/api/modules/<int:mid>")
@connexion_requise("admin")
def modifier_module(mid):
    try:
        d = lire_module(request.get_json(silent=True) or {})
        executer("UPDATE modules SET code=%s, intitule=%s, coefficient=%s, semestre=%s, enseignant_id=%s "
                 "WHERE id=%s", (d["code"], d["intitule"], d["coefficient"], d["semestre"], d["enseignant_id"], mid))
    except ValueError as exc:
        return erreur(str(exc))
    except pymysql.err.IntegrityError:
        return erreur("Ce code de module existe déjà", 409)
    journaliser("MODIFICATION_MODULE", d["code"])
    return ok({"id": mid})


@app.delete("/api/modules/<int:mid>")
@connexion_requise("admin")
def supprimer_module(mid):
    executer("DELETE FROM modules WHERE id = %s", (mid,))
    journaliser("SUPPRESSION_MODULE", str(mid))
    return ok({"id": mid})


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------
def module_autorise(mid):
    """Un enseignant ne gère que les notes de ses propres modules."""
    m = requete("SELECT * FROM modules WHERE id = %s", (mid,), une=True)
    if not m:
        return None, erreur("Module introuvable", 404)
    if g.user["role"] == "enseignant" and m["enseignant_id"] != g.user["id"]:
        return None, erreur("Ce module n'est pas le vôtre", 403)
    return m, None


@app.get("/api/modules/<int:mid>/notes")
@connexion_requise("admin", "enseignant")
def notes_module(mid):
    m, refus = module_autorise(mid)
    if refus:
        return refus
    lignes = requete("""SELECT e.id AS etudiant_id, e.matricule, e.nom, e.prenom, n.note, n.date_saisie
                        FROM etudiants e LEFT JOIN notes n ON n.etudiant_id = e.id AND n.module_id = %s
                        ORDER BY e.nom, e.prenom""", (mid,))
    return ok({"module": m, "notes": lignes})


@app.put("/api/modules/<int:mid>/notes")
@connexion_requise("admin", "enseignant")
def saisir_notes(mid):
    m, refus = module_autorise(mid)
    if refus:
        return refus
    saisies = request.get_json(silent=True) or []
    nb = 0
    for s in saisies:
        try:
            eid = int(s["etudiant_id"])
            valeur = s.get("note")
            if valeur in (None, ""):
                executer("DELETE FROM notes WHERE etudiant_id = %s AND module_id = %s", (eid, mid))
                continue
            valeur = round(float(str(valeur).replace(",", ".")), 2)
        except (KeyError, TypeError, ValueError):
            return erreur("Saisie invalide")
        if not 0 <= valeur <= 20:
            return erreur("Une note doit être comprise entre 0 et 20")
        executer("""INSERT INTO notes (etudiant_id, module_id, note, saisie_par) VALUES (%s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE note = VALUES(note), saisie_par = VALUES(saisie_par),
                                            date_saisie = NOW()""", (eid, mid, valeur, g.user["id"]))
        nb += 1
    journaliser("SAISIE_NOTES", "%s : %d note(s)" % (m["code"], nb))
    return ok({"enregistrees": nb})


@app.get("/api/modules/<int:mid>/notes.csv")
@connexion_requise("admin", "enseignant")
def export_csv(mid):
    m, refus = module_autorise(mid)
    if refus:
        return refus
    lignes = requete("""SELECT e.matricule, e.nom, e.prenom, n.note FROM etudiants e
                        LEFT JOIN notes n ON n.etudiant_id = e.id AND n.module_id = %s
                        ORDER BY e.nom""", (mid,))
    tampon = io.StringIO()
    w = csv.writer(tampon, delimiter=";")
    w.writerow(["Matricule", "Nom", "Prénom", "Note /20"])
    for l in lignes:
        w.writerow([l["matricule"], l["nom"], l["prenom"], "" if l["note"] is None else str(l["note"]).replace(".", ",")])
    journaliser("EXPORT_CSV", m["code"])
    return Response("﻿" + tampon.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=notes-%s.csv" % m["code"]})


@app.get("/api/bulletin/<int:eid>")
@connexion_requise()
def bulletin(eid):
    if g.user["role"] == "etudiant" and g.user["etudiant_id"] != eid:
        journaliser("ACCES_REFUSE", "Bulletin de l'étudiant %d" % eid)
        return erreur("Vous ne pouvez consulter que votre propre bulletin", 403)
    e = requete("SELECT id, matricule, nom, prenom, filiere, annee FROM etudiants WHERE id = %s", (eid,), une=True)
    if not e:
        return erreur("Étudiant introuvable", 404)
    lignes = requete("""SELECT m.code, m.intitule, m.coefficient, m.semestre, n.note
                        FROM modules m LEFT JOIN notes n ON n.module_id = m.id AND n.etudiant_id = %s
                        ORDER BY m.semestre, m.code""", (eid,))
    total = sum(float(l["note"]) * l["coefficient"] for l in lignes if l["note"] is not None)
    coefs = sum(l["coefficient"] for l in lignes if l["note"] is not None)
    for l in lignes:
        l["resultat"] = None if l["note"] is None else ("Validé" if l["note"] >= SEUIL_VALIDATION else "Non validé")
    moyenne = round(total / coefs, 2) if coefs else None
    return ok({"etudiant": e, "modules": lignes, "moyenne": moyenne, "seuil": SEUIL_VALIDATION,
               "complet": all(l["note"] is not None for l in lignes)})


# ---------------------------------------------------------------------------
# Comptes et journal (administration)
# ---------------------------------------------------------------------------
@app.get("/api/utilisateurs")
@connexion_requise("admin")
def liste_utilisateurs():
    return ok(requete("""SELECT id, login, nom_complet, role, etudiant_id, actif, derniere_connexion
                         FROM utilisateurs ORDER BY role, login"""))


@app.get("/api/enseignants")
@connexion_requise("admin")
def liste_enseignants():
    return ok(requete("SELECT id, nom_complet FROM utilisateurs WHERE role = 'enseignant' ORDER BY nom_complet"))


@app.post("/api/utilisateurs")
@connexion_requise("admin")
def creer_utilisateur():
    c = request.get_json(silent=True) or {}
    login_, nom, role = str(c.get("login", "")).strip(), str(c.get("nom_complet", "")).strip(), c.get("role")
    mdp = str(c.get("password", ""))
    eid = int(c["etudiant_id"]) if c.get("etudiant_id") else None
    if not login_ or not nom or role not in ("admin", "enseignant", "etudiant"):
        return erreur("Login, nom et rôle valides sont obligatoires")
    if len(mdp) < 10:
        return erreur("Le mot de passe doit contenir au moins 10 caractères")
    if role == "etudiant" and not eid:
        return erreur("Un compte étudiant doit être lié à un dossier étudiant")
    try:
        nouvel_id = executer("INSERT INTO utilisateurs (login, mot_de_passe, nom_complet, role, etudiant_id) "
                             "VALUES (%s, %s, %s, %s, %s)",
                             (login_, generate_password_hash(mdp, method="pbkdf2:sha256:600000"), nom, role, eid))
    except pymysql.err.IntegrityError:
        return erreur("Ce login existe déjà", 409)
    journaliser("CREATION_COMPTE", "%s (%s)" % (login_, role))
    return ok({"id": nouvel_id}, 201)


@app.put("/api/utilisateurs/<int:uid>/actif")
@connexion_requise("admin")
def activer_utilisateur(uid):
    if uid == g.user["id"]:
        return erreur("Vous ne pouvez pas désactiver votre propre compte")
    actif = bool((request.get_json(silent=True) or {}).get("actif"))
    executer("UPDATE utilisateurs SET actif = %s WHERE id = %s", (actif, uid))
    journaliser("ACTIVATION_COMPTE" if actif else "DESACTIVATION_COMPTE", str(uid))
    return ok({"id": uid, "actif": actif})


@app.get("/api/journal")
@connexion_requise("admin")
def journal():
    return ok(requete("SELECT * FROM journal ORDER BY id DESC LIMIT 200"))


# ---------------------------------------------------------------------------
# Gestion des erreurs
# ---------------------------------------------------------------------------
@app.errorhandler(404)
def introuvable(_e):
    return erreur("Ressource introuvable", 404)


@app.errorhandler(Exception)
def erreur_interne(exc):
    if isinstance(exc, HTTPException):          # 404, 405... : erreurs normales du protocole HTTP
        return erreur(exc.description, exc.code)
    if CONFIG["MODE_DEBUG"]:
        # Mode debug : on renvoie tout le détail (pratique en développement,
        # dangereux en production car cela révèle la structure interne).
        return jsonify({"erreur": str(exc), "trace": traceback.format_exc()}), 500
    app.logger.exception("Erreur interne")
    return erreur("Erreur interne du serveur", 500)


if __name__ == "__main__":
    # Lancement de test uniquement ; en service, l'API est lancée par gunicorn.
    app.run(host="127.0.0.1", port=8080)
