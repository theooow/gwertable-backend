# Journal administrateur

Accès réservé au compte `theooow@hotmail.com`, indépendamment des rôles des espaces.

- `GET /api/admin/overview` : compteurs globaux, trafic/erreurs/lenteurs sur 24 h (hors administration), 100 comptes récents.
- `GET /api/admin/logs` : liste sans corps, pagination par curseur, filtres `q`, `userId`, `method`, `status=errors|server|success`, `activity=true`, `from`, `to`, `limit` (1–100).
- `GET /api/admin/logs/:id` : requête, paramètres et réponse expurgés.

La migration crée `ApiLog`. La collecte commence au déploiement : aucun historique antérieur n'est reconstitué. Tous les appels entrants traités par Fastify sont enregistrés après réponse, y compris les refus d'authentification et les erreurs. Les appels sortants vers des services tiers, les erreurs du frontend avant appel au backend et les connexions interrompues avant réponse ne sont pas couverts.

Les actions correspondent aux mutations HTTP réussies (création de compte/événement, connexion, modification, suppression…). Ce journal ne remplace pas un audit transactionnel des opérations en base ou des tâches exécutées en arrière-plan.

Les tokens, mots de passe, cookies et clés reconnus sont masqués récursivement. Les en-têtes ne sont pas conservés. Les corps JSON sont limités à 32 Ko, 100 éléments/champs et 12 niveaux ; fichiers, flux et corps non JSON sont omis. Les réponses de consultation de l'administration sont omises pour éviter de recopier le journal dans lui-même. Les chemins utilisent le modèle de route ; les paramètres expurgés sont consultables dans le détail. Une adresse saisie lors d'une tentative de connexion est marquée non authentifiée tant qu'aucun compte n'est identifié.

Conservation de 30 jours, purge au démarrage puis toutes les heures. La table n'a pas de relations destructives vers les comptes ou événements pour préserver l'historique après suppression. Une indisponibilité de stockage est signalée dans les logs serveur (`API journal persistence failed`) et n'empêche pas la réponse utilisateur ; des entrées peuvent donc manquer pendant une panne. Les réponses API incluent `x-request-id` pour faciliter les diagnostics.

Validation locale : `npm run typecheck`, `npm run typecheck:tests`, `node --import tsx --import ./tests/setup-env.ts --test tests/api-logs.test.ts`. La suite complète exige une base PostgreSQL de test migrée ; le workflow de déploiement la fournit.
