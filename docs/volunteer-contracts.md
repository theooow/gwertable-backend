# Conventions de bénévolat

## Parcours automatique

Dans **Paramètres → Structure et conventions**, l’administrateur renseigne le
nom légal, la forme juridique, l’adresse du siège, le représentant et sa fonction,
l’email de contact, ainsi que le téléphone, SIRET et RNA si disponibles. Ces
informations sont propres à l’espace et alimentent les PDF et leurs instantanés.
Le panneau de gestion des bénévoles affiche les champs essentiels manquants et
un lien vers cette section pour l’administrateur. Les SIRET/RNA sont facultatifs.
Le contact et le référent du formulaire événement peuvent remplacer ceux de la
structure. Modifier une information utilisée renouvelle la convention à signer.

Une candidature validée doit avoir un email et au moins un créneau affecté pour
disposer de sa convention dans le portail personnel. Les emails de modification
du planning rappellent de la signer. L’onglet Conventions de l’événement est
supprimé ; les archives restent disponibles dans la fiche contact.

Le PDF contient l’organisme (identité légale si renseignée), le référent, le
bénévole, le lieu, les dates, chaque poste, équipe, horaire et consigne de mission.
Les clauses couvrent l’engagement libre et non rémunéré, l’accueil, les changements
de mission, les données personnelles et l’acceptation par signature simple.

Le formulaire d’inscription permet de configurer le représentant, le contact
organisateur/RGPD et la conservation. Valeurs par défaut : équipe d’organisation,
email du premier administrateur de l’espace et **3 ans après la fin de l’événement**.
Renseigner le lieu dans l’événement et les missions dans les notes des créneaux.
L’organisateur reste chargé de la suppression/anonymisation à échéance : aucune
purge automatique des conventions n’est effectuée.

## Versions et accès

Les modifications du planning, affectations automatiques, retraits de validation
et échanges synchronisent la convention dans la même transaction sérialisable.
Le portail synchronise aussi les anciennes conventions et les changements de
paramètres. Les missions et conditions sont figées dans un instantané et une empreinte.
Tout changement annule les versions en attente et nécessite une nouvelle signature.
Les exemplaires signés restent immuables et consultables par l’organisateur.
Retirer le dernier créneau termine la version : réaffecter exactement le même
créneau ne réactive pas la signature antérieure.

Chaque accès public et signature vérifie les affectations et la dernière version.
Les liens du portail sont stockés dans une table d’accès séparée pour ne jamais
réécrire un exemplaire signé. Ils sont valables 30 jours, renouvelables depuis le
portail et révoqués par la rotation du lien du portail. Les anciennes API de
création manuelle exigent également une affectation et incluent les clauses et
missions automatiques.

## PDF et preuve

La base conserve les PDF source et signé avec leurs SHA-256 et protège le contenu
figé ainsi que les conventions signées/annulées. L’attestation en fin du PDF signé
indique l’identité déclarée, l’email vérifié, le consentement, les dates serveur,
l’IP observée et l’empreinte du document présenté.

Le dossier JSON version 2 contient les preuves, l’instantané des missions, le
texte et les deux PDF en base64. Décoder les PDF et comparer leurs SHA-256 aux
empreintes déclarées ; celle de la source doit correspondre à `evidence.documentHash`.
Les anciens dossiers restent téléchargeables avec leurs preuves d’origine.

Ce procédé est une signature électronique simple par code email, sans vérification
d’identité civile, certificat PAdES ou horodatage qualifié. L’IP peut être celle du
proxy. Un administrateur de base peut techniquement modifier les données : ce
n’est pas un archivage probant indépendant.

## Configuration et tests

Migration `20260925120000_volunteer_contract_assignments`, sans variable nouvelle.
Configurer SMTP et FRONTEND_URL en HTTPS. Le transport `log` refuse les codes.
Codes valables 10 minutes, 5 essais, 1 envoi/minute et 10 envois par convention.
Masquer les liens/codes dans les logs et proxies ; pas d’analytics tiers sur la signature.
Les accès organisateur conservent les contrôles workspace/événement/contact.
Les téléchargements sont privés et sans cache ; les empreintes sont vérifiées.

`npm run typecheck`, `npm run typecheck:tests`, `npm test` sur une base de test
dédiée avec les migrations appliquées. SMTP est simulé dans les tests.

Références des clauses : [guide du bénévolat](https://www.associations.gouv.fr/IMG/pdf/guide_benevolat_2024-2025.pdf),
[durées de conservation — CNIL](https://www.cnil.fr/fr/passer-laction/les-durees-de-conservation-des-donnees).
Les trois ans sont le choix de l’organisateur, pas une durée légale universelle.
