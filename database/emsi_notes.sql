-- =====================================================================
-- EMSI Notes : création des tables et données d'exemple
-- Base MySQL 8 / MariaDB 10.5+  (jeu de caractères utf8mb4)
-- Utilisation :  mysql -h <hôte> -u <utilisateur> -p emsi_notes < emsi_notes.sql
-- Toutes les personnes et coordonnées ci-dessous sont fictives.
-- =====================================================================

SET NAMES utf8mb4;

DROP TABLE IF EXISTS journal;
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS modules;
DROP TABLE IF EXISTS utilisateurs;
DROP TABLE IF EXISTS etudiants;

-- Dossier administratif des étudiants (données personnelles)
CREATE TABLE etudiants (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  matricule       VARCHAR(12)  NOT NULL UNIQUE,
  nom             VARCHAR(60)  NOT NULL,
  prenom          VARCHAR(60)  NOT NULL,
  email           VARCHAR(120) NOT NULL,
  telephone       VARCHAR(20),
  date_naissance  DATE,
  filiere         VARCHAR(60)  NOT NULL,
  annee           TINYINT      NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Comptes de connexion. Le mot de passe n'est jamais stocké en clair :
-- seule son empreinte (PBKDF2-SHA256, 600 000 itérations) est enregistrée.
CREATE TABLE utilisateurs (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  login           VARCHAR(40)  NOT NULL UNIQUE,
  mot_de_passe    VARCHAR(255) NOT NULL,
  nom_complet     VARCHAR(120) NOT NULL,
  role            ENUM('admin','enseignant','etudiant') NOT NULL,
  etudiant_id     INT NULL,
  actif           BOOLEAN NOT NULL DEFAULT TRUE,
  derniere_connexion DATETIME NULL,
  FOREIGN KEY (etudiant_id) REFERENCES etudiants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Modules d'enseignement, chacun rattaché à un enseignant
CREATE TABLE modules (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  code            VARCHAR(12)  NOT NULL UNIQUE,
  intitule        VARCHAR(120) NOT NULL,
  coefficient     TINYINT      NOT NULL DEFAULT 1,
  semestre        VARCHAR(4)   NOT NULL,
  enseignant_id   INT NULL,
  FOREIGN KEY (enseignant_id) REFERENCES utilisateurs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Une note par étudiant et par module (sur 20)
CREATE TABLE notes (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  etudiant_id     INT NOT NULL,
  module_id       INT NOT NULL,
  note            DECIMAL(4,2) NOT NULL,
  saisie_par      INT NULL,
  date_saisie     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY une_note (etudiant_id, module_id),
  FOREIGN KEY (etudiant_id) REFERENCES etudiants(id) ON DELETE CASCADE,
  FOREIGN KEY (module_id)   REFERENCES modules(id)   ON DELETE CASCADE,
  FOREIGN KEY (saisie_par)  REFERENCES utilisateurs(id) ON DELETE SET NULL,
  CHECK (note BETWEEN 0 AND 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Journal d'audit : qui a fait quoi, quand, depuis quelle adresse
CREATE TABLE journal (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  date_action     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  login           VARCHAR(40),
  action          VARCHAR(40) NOT NULL,
  detail          VARCHAR(255),
  adresse_ip      VARCHAR(45)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------- étudiants
INSERT INTO etudiants (matricule,nom,prenom,email,telephone,date_naissance,filiere,annee) VALUES
  ('E2026001','Amrani','Yassine','yassine.amrani@etu.emsi-notes.local','0615881399','2004-10-18','Informatique et Réseaux',4),
  ('E2026002','Benali','Salma','salma.benali@etu.emsi-notes.local','0679730911','2003-02-15','Informatique et Réseaux',4),
  ('E2026003','Cherkaoui','Omar','omar.cherkaoui@etu.emsi-notes.local','0607536455','2004-12-17','Informatique et Réseaux',4),
  ('E2026004','Daoudi','Imane','imane.daoudi@etu.emsi-notes.local','0615188447','2002-11-23','Informatique et Réseaux',4),
  ('E2026005','El Fassi','Mehdi','mehdi.elfassi@etu.emsi-notes.local','0694055761','2004-10-18','Informatique et Réseaux',4),
  ('E2026006','Filali','Kenza','kenza.filali@etu.emsi-notes.local','0671689768','2003-07-19','Informatique et Réseaux',4),
  ('E2026007','Ghazali','Anas','anas.ghazali@etu.emsi-notes.local','0678809320','2001-12-20','Informatique et Réseaux',4),
  ('E2026008','Hajji','Rim','rim.hajji@etu.emsi-notes.local','0667273177','2003-09-13','Informatique et Réseaux',4),
  ('E2026009','Idrissi','Hamza','hamza.idrissi@etu.emsi-notes.local','0648876634','2003-01-02','Informatique et Réseaux',4),
  ('E2026010','Jabri','Nour','nour.jabri@etu.emsi-notes.local','0629787534','2004-08-17','Informatique et Réseaux',4),
  ('E2026011','Kettani','Adam','adam.kettani@etu.emsi-notes.local','0676804571','2004-12-23','Informatique et Réseaux',4),
  ('E2026012','Lahlou','Sara','sara.lahlou@etu.emsi-notes.local','0684726714','2004-06-04','Informatique et Réseaux',4),
  ('E2026013','Mansouri','Ayoub','ayoub.mansouri@etu.emsi-notes.local','0636270107','2001-10-26','Informatique et Réseaux',4),
  ('E2026014','Naciri','Hiba','hiba.naciri@etu.emsi-notes.local','0633190845','2002-01-11','Informatique et Réseaux',4),
  ('E2026015','Ouazzani','Karim','karim.ouazzani@etu.emsi-notes.local','0699728379','2002-10-23','Informatique et Réseaux',4),
  ('E2026016','Rachidi','Lina','lina.rachidi@etu.emsi-notes.local','0684162294','2004-07-26','Informatique et Réseaux',4),
  ('E2026017','Saidi','Othmane','othmane.saidi@etu.emsi-notes.local','0628360161','2001-06-21','Informatique et Réseaux',4),
  ('E2026018','Tazi','Meryem','meryem.tazi@etu.emsi-notes.local','0650087547','2003-02-16','Informatique et Réseaux',4),
  ('E2026019','Alaoui','Ilyas','ilyas.alaoui@etu.emsi-notes.local','0679922983','2004-10-11','Informatique et Réseaux',4),
  ('E2026020','Berrada','Aya','aya.berrada@etu.emsi-notes.local','0679318603','2002-01-21','Informatique et Réseaux',4),
  ('E2026021','Chraibi','Zakaria','zakaria.chraibi@etu.emsi-notes.local','0680737028','2002-09-05','Cloud et Cybersécurité',4),
  ('E2026022','Doukkali','Yasmine','yasmine.doukkali@etu.emsi-notes.local','0622646861','2004-05-06','Cloud et Cybersécurité',4),
  ('E2026023','Essaadi','Reda','reda.essaadi@etu.emsi-notes.local','0652477647','2002-06-17','Cloud et Cybersécurité',4),
  ('E2026024','Fikri','Ghita','ghita.fikri@etu.emsi-notes.local','0677188413','2002-01-03','Cloud et Cybersécurité',4),
  ('E2026025','Guessous','Soufiane','soufiane.guessous@etu.emsi-notes.local','0675682052','2003-09-22','Cloud et Cybersécurité',4),
  ('E2026026','Hilali','Malak','malak.hilali@etu.emsi-notes.local','0698319489','2002-10-10','Cloud et Cybersécurité',4),
  ('E2026027','Iraqi','Nabil','nabil.iraqi@etu.emsi-notes.local','0694821416','2002-02-22','Cloud et Cybersécurité',4),
  ('E2026028','Kabbaj','Chaima','chaima.kabbaj@etu.emsi-notes.local','0605218549','2001-05-11','Cloud et Cybersécurité',4),
  ('E2026029','Lamrani','Badr','badr.lamrani@etu.emsi-notes.local','0624410646','2001-01-04','Cloud et Cybersécurité',4),
  ('E2026030','Mernissi','Douae','douae.mernissi@etu.emsi-notes.local','0630411895','2003-08-20','Cloud et Cybersécurité',4);

-- ---------------------------------------------------------------- comptes
-- Mots de passe de démonstration : voir le fichier LISEZMOI.md
INSERT INTO utilisateurs (login,mot_de_passe,nom_complet,role,etudiant_id) VALUES
  ('admin','pbkdf2:sha256:600000$8jSkvxiub8qFn11e$1ea9829efc50b4813df97a7ac243670ba1e5cfe1da8558c14c0126038b0b459f','Administration scolarité','admin',NULL),
  ('prof.amrani','pbkdf2:sha256:600000$8KynP95RoRd2y51B$382dafb4b0c3ed521f8c16e44a9f5d5910c4d4d23618da152445f1fc00cbd534','Pr. Rachid Amrani','enseignant',NULL),
  ('prof.bennis','pbkdf2:sha256:600000$MJPTMz39U1WQ1FBH$52201df4208d5770aa5553e2e9820bffaee8fd9647b50589b83c168b8eba8f22','Pr. Leila Bennis','enseignant',NULL),
  ('prof.zerouali','pbkdf2:sha256:600000$uVhFtSc7lwVRlamH$1f81c958bea660bf78502e503353c05cf919584520ee60704201967a925e6444','Pr. Hicham Zerouali','enseignant',NULL),
  ('e2026001','pbkdf2:sha256:600000$gqyJ3Eq0HGyxo7b0$78b964143e1050dd8c415212e04647c213ab8392fd5031a0e45e3ec39c5186e8','Yassine Amrani','etudiant',1),
  ('e2026002','pbkdf2:sha256:600000$LM6ibKpJa4a2l6m4$1c19430a91cd679bfc71be96b3116539ad1685c450cd782cd41ef1c805201fd1','Salma Benali','etudiant',2),
  ('e2026003','pbkdf2:sha256:600000$4J3JV2TsGlk1GgWl$71036fc248e405990eff689b2816ac7dd57ad4dab883119038908d8de965d1f5','Omar Cherkaoui','etudiant',3);

-- ---------------------------------------------------------------- modules
INSERT INTO modules (code,intitule,coefficient,semestre,enseignant_id) VALUES
  ('CS401','Sécurité du Cloud',3,'S7',2),
  ('RS402','Réseaux avancés',2,'S7',3),
  ('SY403','Administration Linux',2,'S7',4),
  ('BD404','Bases de données avancées',2,'S7',3),
  ('DW405','Développement web',2,'S8',4),
  ('LG406','Anglais technique',1,'S8',2);

-- ---------------------------------------------------------------- notes
-- Les modules du semestre S8 (5 et 6) ne sont pas encore tous notés.
INSERT INTO notes (etudiant_id,module_id,note,saisie_par) VALUES
  (1,1,14.75,2),
  (1,2,9.25,3),
  (1,3,12.25,4),
  (1,4,13.75,3),
  (1,5,13.75,4),
  (1,6,12.50,2),
  (2,1,10.25,2),
  (2,2,12.50,3),
  (2,3,13.50,4),
  (2,4,17.25,3),
  (2,5,11.50,4),
  (2,6,11.75,2),
  (3,1,11.00,2),
  (3,2,16.25,3),
  (3,3,17.50,4),
  (3,4,12.75,3),
  (3,5,13.25,4),
  (3,6,16.25,2),
  (4,1,17.50,2),
  (4,2,12.50,3),
  (4,3,13.50,4),
  (4,4,14.75,3),
  (4,5,10.25,4),
  (4,6,17.75,2),
  (5,1,6.00,2),
  (5,2,13.50,3),
  (5,3,7.00,4),
  (5,4,6.50,3),
  (5,5,6.00,4),
  (5,6,9.75,2),
  (6,1,16.50,2),
  (6,2,11.25,3),
  (6,3,12.25,4),
  (6,4,9.75,3),
  (6,5,12.00,4),
  (6,6,11.75,2),
  (7,1,15.50,2),
  (7,2,16.50,3),
  (7,3,11.75,4),
  (7,4,10.50,3),
  (7,5,16.00,4),
  (7,6,14.50,2),
  (8,1,15.50,2),
  (8,2,14.75,3),
  (8,3,10.25,4),
  (8,4,8.50,3),
  (8,5,12.75,4),
  (8,6,11.75,2),
  (9,1,12.75,2),
  (9,2,16.75,3),
  (9,3,12.50,4),
  (9,4,13.00,3),
  (9,5,12.00,4),
  (9,6,18.50,2),
  (10,1,17.25,2),
  (10,2,13.25,3),
  (10,3,14.75,4),
  (10,4,16.50,3),
  (10,5,11.00,4),
  (10,6,17.25,2),
  (11,1,11.00,2),
  (11,2,9.50,3),
  (11,3,10.75,4),
  (11,4,13.00,3),
  (11,5,10.25,4),
  (11,6,15.00,2),
  (12,1,16.75,2),
  (12,2,13.75,3),
  (12,3,17.25,4),
  (12,4,15.50,3),
  (12,5,13.25,4),
  (12,6,17.75,2),
  (13,1,10.75,2),
  (13,2,10.75,3),
  (13,3,13.50,4),
  (13,4,14.25,3),
  (13,5,12.50,4),
  (13,6,9.50,2),
  (14,1,8.50,2),
  (14,2,9.25,3),
  (14,3,5.25,4),
  (14,4,8.00,3),
  (14,5,13.00,4),
  (14,6,9.50,2),
  (15,1,7.50,2),
  (15,2,8.75,3),
  (15,3,9.75,4),
  (15,4,11.75,3),
  (15,5,9.50,4),
  (15,6,13.00,2),
  (16,1,12.00,2),
  (16,2,9.00,3),
  (16,3,11.50,4),
  (16,4,10.25,3),
  (16,5,7.25,4),
  (16,6,5.25,2),
  (17,1,11.50,2),
  (17,2,15.00,3),
  (17,3,13.75,4),
  (17,4,12.50,3),
  (17,5,14.75,4),
  (17,6,8.00,2),
  (18,1,8.25,2),
  (18,2,9.50,3),
  (18,3,7.50,4),
  (18,4,11.00,3),
  (18,5,10.50,4),
  (18,6,6.75,2),
  (19,1,13.50,2),
  (19,2,13.50,3),
  (19,3,12.25,4),
  (19,4,14.25,3),
  (20,1,16.75,2),
  (20,2,18.50,3),
  (20,3,17.00,4),
  (20,4,19.25,3),
  (21,1,13.00,2),
  (21,2,13.00,3),
  (21,3,13.75,4),
  (21,4,11.25,3),
  (22,1,10.00,2),
  (22,2,12.25,3),
  (22,3,11.00,4),
  (22,4,10.00,3),
  (23,1,10.25,2),
  (23,2,10.50,3),
  (23,3,11.00,4),
  (23,4,11.75,3),
  (24,1,7.00,2),
  (24,2,8.75,3),
  (24,3,9.25,4),
  (24,4,6.50,3),
  (25,1,7.50,2),
  (25,2,5.75,3),
  (25,3,11.50,4),
  (25,4,5.50,3),
  (26,1,8.50,2),
  (26,2,7.00,3),
  (26,3,10.00,4),
  (26,4,10.00,3),
  (27,1,10.50,2),
  (27,2,11.25,3),
  (27,3,15.00,4),
  (27,4,15.75,3),
  (28,1,7.25,2),
  (28,2,14.50,3),
  (28,3,13.25,4),
  (28,4,13.00,3),
  (29,1,11.50,2),
  (29,2,7.50,3),
  (29,3,9.50,4),
  (29,4,10.50,3),
  (30,1,13.75,2),
  (30,2,11.75,3),
  (30,3,10.50,4),
  (30,4,9.00,3);

INSERT INTO journal (login,action,detail,adresse_ip) VALUES ('systeme','INITIALISATION','Création de la base et des données d''exemple','127.0.0.1');
