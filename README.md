# API de support informatique

Projet pédagogique : gérer des tickets et les comptes des employés avec Node.js, Express, TypeScript, PostgreSQL et Prisma 7.10.1.

## Ce que fait l'API

- Créer, lister et rechercher les tickets ; modifier leur statut.
- Créer des comptes uniquement depuis un Super Admin, sans inscription publique.
- Inviter un utilisateur et lui permettre de choisir son mot de passe.
- Se connecter avec email et mot de passe.
- Recevoir un JWT d'accès et un refresh token.
- Renouveler les jetons, se déconnecter et révoquer les sessions.
- Appliquer les permissions selon le rôle et le propriétaire du ticket.
- Réinitialiser un mot de passe avec un lien temporaire à usage unique.
- Désactiver et réactiver les comptes.
- Envoyer les emails avec Resend ou les enregistrer localement pendant le développement.

## Démarrage sur ton ordinateur

### Terminal 1 : le serveur

Arrêter l'ancien serveur avec **Ctrl + C**, puis :

```powershell
npm run dev
```

Laisser ce terminal ouvert. Le serveur écoute sur **http://localhost:3000**.
Cette commande surveille les fichiers et redémarre automatiquement après les modifications.
Les anciens jetons d'accès ne correspondent plus au nouveau format : se reconnecter dans Insomnia.

### Terminal 2 : les commandes de gestion

Pour installer le projet sur un nouvel ordinateur :

1. Installer Node.js compatible (par exemple la branche 22 à partir de 22.12, ou 24+), npm et PostgreSQL.
2. Créer la base `support_tickets` dans PostgreSQL.
3. Installer les dépendances :

```powershell
npm install
```

4. Copier `.env.example` vers `.env` uniquement si ce dernier n'existe pas déjà.
5. Renseigner `DATABASE_URL` avec les identifiants PostgreSQL.
6. Générer une clé pour `JWT_ACCESS_SECRET` :

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copier la valeur dans `.env`. Ne pas partager la clé ni le fichier.

7. Appliquer les migrations puis générer le client :

```powershell
npm run db:migrate
npm run db:generate
```

Les commandes utilisent explicitement `prisma7.config.ts`. Garder Prisma en version 7.

Pour créer le tout premier Super Admin, renseigner temporairement `SUPER_ADMIN_EMAIL` et `SUPER_ADMIN_PASSWORD` (16 caractères minimum) dans `.env`, puis :

```powershell
npm run admin:create
```

Supprimer ensuite la ligne du mot de passe de `.env`. Ne pas relancer ce script si le Super Admin existe déjà.

Sous PowerShell, remplacer `npm` par `npm.cmd` et `npx` par `npx.cmd` si l'exécution des scripts est bloquée.

## Permissions

| Action | SUPER_ADMIN | ADMIN | AGENT | USER |
| --- | --- | --- | --- | --- |
| Créer un ticket | Oui | Oui | Oui | Oui |
| Consulter les tickets | Tous | Tous | Tous | Les siens |
| Modifier un statut | Oui | Oui | Oui | Non |
| Voir la liste des utilisateurs | Oui | Oui | Non | Non |
| Créer et inviter un utilisateur | Oui | Non | Non | Non |
| Modifier un rôle | Oui | Non | Non | Non |
| Désactiver / réactiver un compte | Oui | Non | Non | Non |

Le Super Admin ne peut pas changer son propre rôle ni son propre état.
Un compte invité ne peut être activé qu'en acceptant une invitation.
Les anciens tickets sans créateur sont visibles par l'équipe de support, mais pas par les Users.
Les rôles et l'état du compte sont relus dans PostgreSQL à chaque requête protégée.

## Tests dans Insomnia

Aucun terminal supplémentaire n'est nécessaire pour ces étapes. Garder le serveur dans le **terminal 1**.

Pour POST et PATCH, choisir **Body → JSON**.
Pour une route protégée, choisir **Auth → Bearer Token** et coller uniquement la valeur de `accessToken`.

### 1. Connexion

**POST** `http://localhost:3000/auth/login`

```json
{
  "email": "admin@example.com",
  "password": "TON_MOT_DE_PASSE"
}
```

Réponse 200 avec `accessToken`, `refreshToken`, `tokenType: "Bearer"` et `expiresIn: 900`.
Remplacer les valeurs d'exemple par celles du compte existant. Garder les jetons privés.

### 2. Créer un utilisateur et envoyer son invitation

**POST** `http://localhost:3000/users` — jeton du Super Admin.

```json
{
  "email": "employe@example.com",
  "role": "USER"
}
```

Réponse 201 : compte inactif créé et invitation préparée.
Les rôles acceptés sont `SUPER_ADMIN`, `ADMIN`, `AGENT` et `USER`.

En mode local, ouvrir le dernier fichier dans **.local-emails**, puis copier le lien contenu dans `text` dans un navigateur.
Choisir et confirmer un mot de passe de 16 à 128 caractères. Le serveur doit rester lancé.
Le lien expire après 24 heures et ne fonctionne qu'une fois.
La page efface le jeton de la barre d'adresse après son chargement : ne pas actualiser avant d'avoir terminé.

Pour renvoyer une invitation non acceptée :

**POST** `http://localhost:3000/users/2/invitation` — Super Admin, remplacer 2 par le bon identifiant.
Les précédents liens deviennent invalides.

Sans navigateur, il est aussi possible d'utiliser :

**POST** `http://localhost:3000/auth/accept-invitation`

```json
{
  "token": "LA_VALEUR_APRES_token_DANS_LE_LIEN",
  "password": "UN_NOUVEAU_MOT_DE_PASSE_LONG"
}
```

Aucun JWT n'est nécessaire pour accepter l'invitation. Après acceptation, se connecter avec l'email et le mot de passe choisi.

### 3. Tickets

Toutes ces routes nécessitent un jeton d'accès.

| Méthode | URL | Résultat |
| --- | --- | --- |
| GET | /tickets | Liste selon les permissions |
| GET | /tickets/1 | Un ticket accessible |
| POST | /tickets | Création |
| PATCH | /tickets/1/status | Modification par le support |

Corps de création :

```json
{
  "title": "Probleme Wi-Fi",
  "description": "Impossible de me connecter au reseau."
}
```

Le créateur est automatiquement l'utilisateur connecté. Le titre est limité à 150 caractères et la description à 10 000.

Corps de modification de statut :

```json
{
  "status": "IN_PROGRESS"
}
```

Statuts : `OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`.
Un User demandant le ticket d'un autre reçoit 404. Il reçoit 403 s'il essaie de modifier un statut.
Il n'existe pas de route PUT ou DELETE.

### 4. Renouveler les jetons

**POST** `http://localhost:3000/auth/refresh`

```json
{
  "refreshToken": "LE_DERNIER_REFRESH_TOKEN_RECU"
}
```

Aucun Bearer nécessaire. La réponse contient un nouvel access token et un nouveau refresh token.
Toujours remplacer les deux valeurs dans Insomnia.
Un ancien refresh token n'est plus utilisable. Le réutiliser révoque toute la session, y compris le nouveau jeton : il faut alors se reconnecter.

Le JWT dure 15 minutes. La session dure au maximum 7 jours à partir de la connexion ; le renouvellement ne prolonge pas ces 7 jours.

### 5. Se déconnecter

**POST** `http://localhost:3000/auth/logout`

```json
{
  "refreshToken": "LE_REFRESH_TOKEN"
}
```

Réponse 204 sans corps. Toute la session est révoquée : ses JWT et ses refresh tokens sont refusés.
Les autres connexions de la même personne restent actives.

### 6. Consulter son compte

**GET** `http://localhost:3000/auth/me` — Bearer requis.

Renvoie l'identifiant, l'email, le rôle et l'état actif, jamais le hash du mot de passe.

### 7. Mot de passe oublié

**POST** `http://localhost:3000/auth/forgot-password`

```json
{
  "email": "employe@example.com"
}
```

La réponse reste identique que le compte existe ou non.
Ouvrir le lien dans l'email local ou reçu : choisir et confirmer un nouveau mot de passe.
Le lien dure 30 minutes, n'est utilisable qu'une fois et n'active pas un compte désactivé.

Équivalent API :

**POST** `http://localhost:3000/auth/reset-password`

```json
{
  "token": "LE_JETON_DU_LIEN",
  "password": "UN_NOUVEAU_MOT_DE_PASSE_LONG"
}
```

Le changement ferme toutes les sessions de cet utilisateur, invalide les autres liens en attente et nécessite une nouvelle connexion.
Un email de confirmation est préparé.

### 8. Gérer les utilisateurs

**GET** `http://localhost:3000/users` — Super Admin ou Admin.

**PATCH** `http://localhost:3000/users/2/active` — Super Admin :

```json
{
  "isActive": false
}
```

Utiliser `true` pour réactiver un compte ayant déjà accepté son invitation.
La désactivation ferme toutes les sessions et invalide les liens en attente.
La réactivation ne restaure pas les anciennes sessions ; il faut se reconnecter.

**PATCH** `http://localhost:3000/users/2/role` — Super Admin :

```json
{
  "role": "AGENT"
}
```

Les permissions changent dès la requête suivante, sans attendre l'expiration du JWT.

## Emails : local ou Resend

Par défaut, `EMAIL_PROVIDER=local` : aucun email n'est envoyé sur Internet.
Les messages sont écrits dans `.local-emails/`, dossier ignoré par Git contenant des liens privés.
Ce mode ne fonctionne pas avec `NODE_ENV=production`.

Pour envoyer de vrais emails, configurer dans `.env` :

```env
EMAIL_PROVIDER="resend"
RESEND_API_KEY="TA_CLE_RESEND"
EMAIL_FROM="Support <support@ton-domaine.fr>"
APP_URL="http://localhost:3000"
```

Utiliser un expéditeur et des destinataires autorisés par le compte Resend.
En production, utiliser une URL publique HTTPS pour `APP_URL`.
Ne pas publier la clé. Redémarrer le serveur après une modification de `.env`.

Si l'invitation échoue (502), le compte reste créé mais le lien est invalidé.
Corriger la configuration puis utiliser POST /users/:id/invitation.
L'envoi réel doit être testé avec ton compte Resend : les tests automatiques utilisent le mode local.

Référence : [API d'envoi Resend](https://resend.com/docs/api-reference/emails/send-email).

## Explications du code

| Fichier | Rôle |
| --- | --- |
| src/server.ts | Démarrer et arrêter le serveur |
| src/app.ts | Assembler les routes et renvoyer les erreurs JSON |
| src/prisma.ts | Créer la connexion Prisma/PostgreSQL |
| src/auth-routes.ts | Connexion, renouvellement, déconnexion, invitation et mot de passe oublié |
| src/user-routes.ts | Administration des comptes et invitations |
| src/ticket-routes.ts | Routes de tickets et filtre par propriétaire |
| src/tokens.ts | Créer les JWT, générer les jetons aléatoires et calculer leurs empreintes |
| src/middlewares/auth.ts | Vérifier la session, le compte et les rôles |
| src/middlewares/rate-limit.ts | Limiter les tentatives par IP et par route |
| src/email.ts | Préparer les liens et envoyer ou enregistrer les emails |
| src/action-pages.ts | Petits formulaires d'invitation et de réinitialisation |
| src/validation.ts | Vérifier les entrées et définir les erreurs |
| prisma/schema.prisma | Décrire les tables et relations |
| tests/auth.test.ts | Vérifier les parcours avec PostgreSQL |

### Les mots de passe

Argon2 conserve une empreinte du mot de passe, jamais sa valeur en clair.
À la connexion, on compare le mot de passe saisi à cette empreinte.

### Les jetons

- Le JWT signé contient le numéro d'utilisateur et le numéro de session.
- Le refresh token est une valeur aléatoire qui permet de renouveler l'accès.
- Les liens d'invitation et de reset utilisent eux aussi des valeurs aléatoires.
- PostgreSQL conserve uniquement les empreintes SHA-256 de ces valeurs aléatoires.
- Une session est une connexion d'un utilisateur. La révoquer coupe l'accès, même si un JWT n'est pas encore expiré.

### Pourquoi des transactions ?

Une transaction regroupe plusieurs modifications : elles réussissent ensemble ou sont annulées ensemble.
Un verrou court sur le compte empêche deux requêtes de consommer simultanément le même jeton ou de créer une session pendant une désactivation.
Les anciens refresh tokens restent enregistrés pour détecter leur réutilisation.

Les règles des liens temporaires suivent les principes de la [fiche OWASP sur le mot de passe oublié](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## Vérifications

Dans le **terminal 2**, pendant que PostgreSQL fonctionne :

```powershell
npm run check
npm test
```

Les tests démarrent un serveur sur un port temporaire. Ils créent des comptes et tickets de test, puis les suppriment sans toucher aux comptes existants.
Les emails de test restent dans un dossier temporaire supprimé à la fin.

Parcours vérifiés : rôles, propriété des tickets, invitations à usage unique et expirées, renvoi d'invitation, rotation des refresh tokens et rejeu simultané, déconnexion, reset à usage unique, désactivation/réactivation, changement de rôle, session expirée et JSON malformé.

## Codes de réponse

- 200 : opération réussie.
- 201 : ressource créée.
- 204 : déconnexion réussie sans corps de réponse.
- 400 : données ou lien invalides.
- 401 : connexion requise ou session invalide.
- 403 : permissions insuffisantes.
- 404 : ressource absente ou ticket inaccessible.
- 409 : email déjà utilisé ou opération incompatible avec l'état du compte.
- 413 : corps JSON trop volumineux.
- 429 : trop de tentatives ; attendre le délai Retry-After.
- 500 : erreur interne.
- 502 : échec de l'envoi de l'invitation.

## Limites du projet pédagogique

La limitation des tentatives est en mémoire pour un seul serveur ; un déploiement avec plusieurs instances nécessite un stockage partagé. Les listes ne sont pas paginées.
Les jetons sont renvoyés en JSON pour les tests Insomnia : une future application web devra définir une stratégie de stockage adaptée.
Le statut de ticket reste un texte contrôlé par l'API.
Aucun utilisateur n'est autorisé à changer son email ; aucune inscription publique n'existe.
