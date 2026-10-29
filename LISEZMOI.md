# EMSI Notes

Application pédagogique de gestion de la scolarité (étudiants, modules, notes, bulletins, comptes, journal d'audit), écrite pour le TP du module 4 du cours **Sécurité du Cloud** de l'EMSI : déployer une application web sur un serveur unique, puis en architecture 3 tiers sur AWS.

Toutes les personnes et coordonnées présentes dans la base sont fictives.

> **Attention : application volontairement vulnérable.** Avec `MODE_VULNERABLE=1` (valeur du fichier d'exemple), la recherche de l'annuaire est injectable en SQL, pour les besoins du TP. Ne déployez jamais cette application avec ce réglage ailleurs que dans un environnement de travaux pratiques.

## Architecture

| Couche | Dossier | Technologie | Écoute sur |
|---|---|---|---|
| Présentation (front-end) | `frontend/` | HTML, CSS et JavaScript sans dépendance, servis par Nginx | port 80 |
| Application (API) | `backend/` | Python 3.9+, Flask, lancé par gunicorn | port 8080 |
| Données | `database/` | MySQL 8 ou MariaDB 10.5+ | port 3306 |

Le navigateur ne parle qu'à Nginx. Nginx sert les fichiers du front-end et transmet tout ce qui commence par `/api/` à l'API (proxy inverse). L'API est la seule à se connecter à la base.

Le pied de page de l'application affiche le nom du serveur web (en-tête `X-Web-Server` ajouté par Nginx), celui du serveur API et l'état de la base : on voit ainsi quelle machine a servi chaque couche.

## Contenu du dépôt

```
frontend/
  index.html, style.css, app.js     interface web (page unique)
backend/
  app.py                            API Flask
  requirements.txt                  dépendances Python
  emsi-notes.env.exemple            modèle du fichier de configuration
database/
  emsi_notes.sql                    tables et données d'exemple
```

## Configuration

L'API lit sa configuration dans des variables d'environnement, chargées par systemd depuis `/etc/emsi-notes/emsi-notes.env` (copie de `backend/emsi-notes.env.exemple`). Ce fichier contient des secrets : `chmod 600`, et il ne doit jamais être publié (`*.env` est ignoré par git).

| Variable | Rôle |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME` | Adresse de la base (`localhost`, ou le point de terminaison RDS) |
| `DB_USER`, `DB_PASSWORD` | Compte applicatif de la base |
| `SECRET_KEY` | Clé de signature des jetons de connexion (obligatoire) : `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `MODE_VULNERABLE` | `1` : recherche de l'annuaire injectable (TP) ; `0` : requête paramétrée |
| `MODE_DEBUG` | `1` : les erreurs détaillées sont renvoyées au navigateur (dépannage uniquement) |

## Comptes de démonstration

| Identifiant | Mot de passe | Rôle |
|---|---|---|
| `admin` | `Admin@2026` | administrateur |
| `prof.amrani` | `Prof@2026` | enseignant |
| `prof.bennis` | `Prof@2026` | enseignant |
| `prof.zerouali` | `Prof@2026` | enseignant |
| `e2026001` | `Etudiant@2026` | étudiant |
| `e2026002` | `Etudiant@2026` | étudiant |
| `e2026003` | `Etudiant@2026` | étudiant |

Les mots de passe sont stockés sous forme d'empreinte PBKDF2-SHA256 (600 000 itérations).

## Installation

La procédure complète, commentée pas à pas, est dans l'énoncé du TP (partie 1 pour un serveur unique, partie 2 pour l'architecture 3 tiers). En résumé, sur Amazon Linux 2023 :

1. Créer la base `emsi_notes` et un compte applicatif, puis charger `database/emsi_notes.sql` avec un compte qui a le droit de créer des tables.
2. Créer un environnement virtuel Python, y installer `backend/requirements.txt`, remplir `/etc/emsi-notes/emsi-notes.env`.
3. Lancer l'API avec gunicorn depuis `backend/` (`gunicorn --workers 2 --bind 127.0.0.1:8080 app:app`), sous forme de service systemd.
4. Copier `frontend/` dans la racine de Nginx et transmettre `/api/` à l'API (`proxy_pass http://<adresse_api>:8080;`), en ajoutant `add_header X-Web-Server $hostname always;`.

Contrôle : `curl http://<serveur>/api/health` doit renvoyer `"base": "ok"`.

## Points d'entrée de l'API

| Méthode et chemin | Accès |
|---|---|
| `POST /api/auth/login` | public |
| `GET /api/health` | public (supervision, utilisé par le pied de page) |
| `GET /api/etudiants?q=` | tout utilisateur connecté (annuaire) |
| `GET /api/bulletin/<id>` | l'étudiant concerné, enseignants, admin |
| `GET/PUT /api/modules/<id>/notes` | l'enseignant du module, admin |
| `GET /api/stats` | enseignants, admin |
| `GET /api/utilisateurs`, `GET /api/journal`, `GET /api/info` | admin |

L'authentification utilise un jeton signé (en-tête `Authorization: Bearer ...`), valable 8 heures.
