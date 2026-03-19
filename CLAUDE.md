# CLAUDE.md — Both Equipmnt

## Projet

Site vitrine + portail B2B pour **BOTH EQUIPMNT**, equipementier sportif.
Clubs de sport se connectent au "Vestiaire" pour commander des tenues personnalisees.

## Stack

- **Hosting** : Netlify (static site + serverless functions)
- **Backend** : 2 Netlify Functions (Node.js, esbuild)
- **Bases de donnees** :
  - **Supabase** (PostgreSQL) : donnees transactionnelles (clubs, produits, commandes, lignes, suivi production, demandes)
  - **Notion** : contenu editorial (actualites, portfolio, partenaires, page vision/a propos)
  - ~~**Airtable**~~ : ancienne base, conservee en backup (`airtable-api-backup.js`)
- **Frontend** : HTML/CSS/JS vanilla (pas de framework, pas de build)
- **Fonts** : Google Fonts (Oswald + Work Sans)
- **Images** : hebergees sur Imgur, Google Drive

## Plan de migration (3 phases)

- **Phase 1** (actuel) : Migration Airtable → Supabase, le vestiaire fonctionne pareil cote clubs
- **Phase 2** (actuel) : Back-office admin custom sur /admin (gestion produits, commandes, suivi production)
- **Phase 3** : Pre-generation des pages vitrine depuis Notion (temps de chargement instantanes)
- **Phase 4** (futur) : Authentification securisee via Supabase Auth (Magic Links)

## Architecture des fichiers

```
/
├── index.html                 # Page vitrine principale (hero, vision, actus, portfolio, contact, partenaires)
├── admin.html                 # Back-office admin (commandes, produits, clubs, suivi, demandes)
├── vestiaire.html             # Portail B2B club (login, catalogue, panier, commandes, demandes)
├── vision.html                # Page "A propos" (100% dynamique depuis Notion)
├── portfolio.html             # Liste de tous les projets
├── news.html                  # Liste de toutes les actualites
├── projet-detail.html         # Detail d'un projet (rendu blocks Notion)
├── actualite-detail.html      # Detail d'une actualite
├── mentions-legales.html      # Mentions legales & CGV
├── robots.txt / sitemap.xml   # SEO
├── netlify.toml               # Config Netlify (functions path, esbuild)
├── supabase/
│   ├── schema.sql             # Schema PostgreSQL (tables, FK, index, RLS)
│   └── migrate.js             # Script de migration Airtable → Supabase
└── netlify/functions/
    ├── supabase-api.js        # API Supabase (clubs, produits, commandes, demandes)
    ├── airtable-api-backup.js # Ancien API Airtable (backup, ne pas supprimer)
    └── notion-api.js          # API Notion (actus, portfolio, partenaires, blocks)
```

## Variables d'environnement (Netlify Dashboard)

```
SUPABASE_URL            # URL du projet Supabase (https://xxx.supabase.co)
SUPABASE_ANON_KEY       # Cle anon Supabase (pour les appels cote client/function)
NOTION_KEY              # Bearer token Notion (ntn_...)
NOTION_DB_ACTUALITES    # ID database Notion actualites
NOTION_DB_PORTFOLIO     # ID database Notion portfolio
NOTION_DB_PARTNERS      # ID database Notion partenaires
```

Variables de migration (temporaires, pas besoin en production) :
```
AIRTABLE_TOKEN          # Bearer token Airtable (pour migrate.js uniquement)
AIRTABLE_BASE_ID        # ID de la base Airtable
SUPABASE_SERVICE_KEY    # Cle service Supabase (bypass RLS, pour migrate.js)
```

## Base de donnees Supabase

### Schema (6 tables)

```
clubs
  id (uuid PK), nom, email, emails, logo_url, minimum_commande, active_minimum,
  frais_livraison, admin, derniere_connexion, dernier_email_connexion, airtable_id

produits
  id (uuid PK), nom, image_url, prix_vente_club, tailles (text[]), personnalisation,
  type, description, min_quantite, max_quantite, groupe_stock, stock_groupe,
  club, visible_vestiaire, expire, airtable_id

commandes
  id (uuid PK), reference, club_id (FK → clubs), statut, vu, total, nb_articles,
  frais_livraison, date, airtable_id

lignes
  id (uuid PK), commande_id (FK → commandes), produit_id (FK → produits),
  taille, quantite, nom_perso, numero_perso, airtable_id

suivi_production
  id (uuid PK), commande_id (FK → commandes), etape, statut, date_etape, notes, airtable_id

demandes
  id (uuid PK), club_id (FK → clubs), objet, message, statut, reponse, date, airtable_id
```

### Relations
- `commandes.club_id` → `clubs.id`
- `lignes.commande_id` → `commandes.id` (CASCADE)
- `lignes.produit_id` → `produits.id`
- `suivi_production.commande_id` → `commandes.id` (CASCADE)
- `demandes.club_id` → `clubs.id`

### RLS
Toutes les tables ont RLS active avec policy permissive "anon_all" (phase 1).
Sera restreint en phase 2 avec auth admin.

## Netlify Functions — Endpoints

### supabase-api.js (`/.netlify/functions/supabase-api`)

**GET :**
| Action | Params | Description |
|--------|--------|-------------|
| `getClub` | `email` | Auth par email (champ unique ou liste separee par virgules) |
| `getCatalogue` | `clubId`, `clubNom` | Produits visibles pour le club + `dejaCommande` par produit |
| `getOrders` | `clubId` | Historique commandes du club |
| `getAllOrders` | — | Toutes les commandes (admin only) |
| `getOrderDetail` | `orderId` | Detail commande + lignes (admin, pour facture PDF) |
| `getDemandes` | `clubId` | Demandes/reclamations du club |
| `adminGetClubs` | — | Tous les clubs (admin) |
| `adminGetProduits` | — | Tous les produits (admin) |
| `adminGetSuivi` | `commandeId` | Etapes de suivi d'une commande |
| `adminGetAllDemandes` | — | Toutes les demandes de tous les clubs |

**POST :**
| Action | Body | Description |
|--------|------|-------------|
| `createOrder` | `{ clubId, clubNom, lignes, total }` | Cree commande + lignes |
| `createLignes` | `{ commandeId, lignes }` | Ajoute des lignes a une commande existante |
| `createDemande` | `{ clubId, objet, message }` | Cree une demande |
| `adminCreateClub` | `{ nom, email, ... }` | Cree un club |
| `adminUpdateClub` | `{ id, ... }` | Modifie un club |
| `adminDeleteClub` | `{ id }` | Supprime un club |
| `adminCreateProduit` | `{ nom, prix, ... }` | Cree un produit |
| `adminUpdateProduit` | `{ id, ... }` | Modifie un produit |
| `adminDeleteProduit` | `{ id }` | Supprime un produit |
| `adminUpdateOrder` | `{ id, statut, vu }` | Modifie statut commande |
| `adminDeleteOrder` | `{ id }` | Supprime commande + lignes (cascade) |
| `adminCreateSuivi` | `{ commandeId, etape, statut, ... }` | Ajoute etape suivi |
| `adminUpdateSuivi` | `{ id, ... }` | Modifie etape suivi |
| `adminDeleteSuivi` | `{ id }` | Supprime etape suivi |
| `adminUpdateDemande` | `{ id, statut, reponse }` | Repond a une demande |
| `adminDeleteDemande` | `{ id }` | Supprime une demande |

Helpers internes :
- `sb(path, options)` : requete Supabase REST generique
- `sbGet(table, query)`, `sbPost(table, data)`, `sbPatch(table, query, data)`, `sbDelete(table, query)` : shorthands
- `getDejaCommande(clubId)` : somme des quantites deja commandees par produit

### notion-api.js (`/.netlify/functions/notion-api`)

**GET :**
| Action | Params | Description |
|--------|--------|-------------|
| `getNews` | `id` (opt) | Toutes les actus publiees, ou une seule par ID |
| `getPortfolio` | `id` (opt), `all` (opt) | Projets "mis en avant" ou tous, ou un seul par ID |
| `getProjectBlocks` | `id` | Projet + blocks Notion (paragraphes, images, colonnes...) |
| `getVision` | — | Page "A propos" : blocks Notion (paragraphes, titres, images, colonnes, etc.) |
| `getPartners` | — | Logos partenaires |

Helper `richTextToHtml()` : convertit le rich text Notion en HTML (bold, italic, underline, liens, couleurs).
Helper `mapBlock()` : convertit les blocks Notion en JSON simplifie (heading, paragraph, image, list, quote, video, callout, column_list).

## Vestiaire — Concepts cles

### Authentification
Login par email (pas de mot de passe). L'email est cherche dans la table Clubs (champ `email` unique + champ `emails` multi-valeur separe par virgules).

### State global `S`
```js
const S = {
  club: null,           // { id, nom, email, logoClub, minCommande, activeMin, admin, fraisLivraison }
  products: [],         // catalogue charge depuis Supabase
  cart: [],             // items du panier en cours
  orders: [],           // historique commandes
  currentProduct: null, // produit ouvert dans le modal
  persoData: {},        // { taille: [{ nom, num }, ...] }
  carouselIndex: 0,
  carouselTotal: 0
};
```

### Gestion du stock

Deux mecanismes de limitation :

1. **maxQuantite** (par produit) : quantite max commandable par un club, tous temps confondus
2. **groupeStock + stockGroupe** : plusieurs variantes partagent un stock commun
   - `groupeStock` : identifiant du groupe (ex: "CAGOULE-01")
   - `stockGroupe` : stock total partage

**dejaCommande** : quantites deja commandees par le club (somme des lignes de commandes precedentes), soustrait du max disponible.

**effectiveMax** = `min(maxQuantite - dejaCommande - cartQty, stockGroupe - dejaCommandeGroupe - cartGroupQty)`

Quand effectiveMax atteint 0 : badge "Rupture" sur la carte produit, inputs bloques.

### minQuantite
Minimum de pieces a commander. Pour les produits en `groupeStock`, le minimum est combinable entre variantes (ex: 10 min = 6 taille M + 4 taille L OK). Validation dans `validateOrder()`.

### Personnalisation
Champ `personnalisation` : "Aucune", "Nom", "Numero", "Nom + Numero".
Quand active : bouton "Personnaliser" par taille, overlay modale avec champs nom/numero par piece.
Au panier : chaque piece personnalisee = 1 ligne panier separee (quantite 1).

### Flux de commande
1. Login email → `getClub` (enregistre la derniere connexion)
2. Catalogue → `getCatalogue` (inclut `dejaCommande`)
3. Modal produit → choix tailles/quantites + perso optionnelle
4. Ajout panier → validation min/max
5. Validation commande → `createOrder` (cree Commande + Lignes dans Supabase)
6. Confirmation → affiche ref + coordonnees bancaires (IBAN/BIC) pour virement

### Frais de livraison
Champ `frais_livraison` sur la table Clubs. Ajoutes automatiquement au total de la commande si > 0.

### Facturation (admin)
Onglet visible uniquement pour les clubs avec le flag `admin`. Affiche toutes les commandes de tous les clubs. Bouton "Facture" genere un PDF cote client avec jsPDF (v3.x, CDN cdnjs). Le PDF inclut : en-tete BOTH EQUIPMNT, detail des lignes, sous-total, frais de livraison, total, coordonnees bancaires.

## Back-office Admin (admin.html)

Interface d'administration accessible sur `/admin.html`. Login par email admin (meme mecanisme que le vestiaire, mais verifie le flag `admin` sur le club).

### Sections
- **Commandes** : liste toutes les commandes, stats (total, en attente, CA), recherche/filtre par statut. Detail avec lignes, changement de statut, suivi production (ajouter/supprimer des etapes)
- **Produits** : CRUD complet. Filtre par club. Formulaire avec tous les champs (nom, prix, tailles, perso, stock, visible, expire)
- **Clubs** : CRUD complet. Gestion email, frais livraison, minimum commande, flag admin
- **Demandes** : liste toutes les demandes, changer statut, repondre

### Design
- Sidebar noire avec navigation par section
- Zone principale fond clair avec cards/tables
- Modales pour creer/modifier
- Toasts pour feedback
- `noindex, nofollow` pour ne pas indexer

## Site vitrine (index.html)

Charge le contenu dynamique depuis Notion au load :
- `loadVision()` → teaser "A propos" (premiers paragraphes de la page Notion, avant le 1er heading)
- `loadNews()` → section actualites (scroll horizontal)
- `loadPortfolio()` → grille masonry (4 projets mis en avant)
- `loadPartners()` → logos partenaires

Le bouton "Mon Vestiaire" redirige vers `/vestiaire.html`.
Le formulaire contact utilise Netlify Forms (`data-netlify="true"`).

## Page Vision (vision.html)

100% dynamique depuis Notion via `getVision`. Meme logique que projet-detail.html :
- Spinner pendant le chargement
- Rendu complet de tous les blocks Notion (paragraphes, titres, images, colonnes, citations, listes, videos, callouts)
- Pas de contenu statique en fallback — tout vient de Notion
- Le titre hero "LOOK GOOD, PLAY GOOD" est le seul element statique

## Pages detail (projet-detail, actualite-detail)

Chargent le contenu par `?id=` dans l'URL. Rendu cote client des blocks Notion (paragraphes, titres, images, listes, citations, videos, callouts, colonnes).

## Design system

- Fond noir (`--black: #0a0a0a`), texte clair (`--white: #fafaf8`)
- Accent dore (`--red: #ffd700`) — la variable s'appelle `--red` mais c'est du jaune/or
- Typo display : Oswald (titres, uppercase)
- Typo body : Work Sans
- Responsive : breakpoints 768px et 1024px
- Le vestiaire utilise un theme clair (fond blanc) a l'interieur du portail

## Conventions de code

- Tout en vanilla JS, pas de modules, pas de bundler
- CSS inline dans chaque fichier HTML (pas de fichier CSS separe)
- Fonctions globales, pas de classes
- State global `S` dans le vestiaire
- `toast(msg)` pour les notifications utilisateur
- `fmt(n)` pour formater les prix (ex: `12,50 €`)
- API calls via `apiGet(action, params)` et `apiPost(action, body)` dans le vestiaire
- Notion API via `fetch(NOTION_API + '?action=...')` dans les pages publiques

## Commandes utiles

```bash
# Pas de build necessaire — site statique
# Pour tester localement :
npx netlify-cli dev

# Les functions sont dans netlify/functions/
# Les variables d'env doivent etre dans le dashboard Netlify ou un .env local

# Migration Airtable → Supabase (a executer une seule fois) :
# 1. Executer supabase/schema.sql dans le SQL Editor de Supabase
# 2. Puis :
AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=eyJ... node supabase/migrate.js
```

## Phase 4 — Supabase Auth (a faire quand le nombre de clubs augmente)

Actuellement l'auth vestiaire est un simple lookup par email dans la table `clubs` (pas de mot de passe, pas de session).
Ca fonctionne mais n'importe qui connaissant l'email d'un club peut acceder a son vestiaire.

**Plan prevu :**
- Utiliser **Supabase Auth** avec **Magic Links** (lien de connexion envoye par email)
- Meme UX qu'aujourd'hui pour les clubs (pas de mot de passe), mais securise avec un vrai token de session
- Activer le **RLS reel** sur les tables (chaque club ne voit que ses propres donnees cote base)
- Sessions persistantes (pas besoin de se reconnecter a chaque visite)
- Migrer les clubs existants vers Supabase Auth (creer un user par club)

**Points d'attention pour la migration :**
- Certains clubs ont plusieurs emails (champ `emails` separe par virgules) — il faudra gerer ca
- L'admin utilise le meme mecanisme d'auth (flag `admin` sur le club) — a migrer aussi
- Tester sur un club pilote avant de migrer tout le monde

**Declencheur** : quand le nombre de clubs devient significatif et que la securite devient un enjeu.

## Points d'attention

- La variable CSS `--red` est en realite du jaune/or (#ffd700), pas du rouge
- Le champ `personnalisable` dans le JS correspond au champ `personnalisation` en base
- Les images produits peuvent etre une URL unique ou une liste separee par virgules
- jsPDF est charge depuis cdnjs (v3.x) — si le CDN retire la version, mettre a jour le lien dans `vestiaire.html`
- Le formulaire contact est un Netlify Form (soumis en POST sur `/`)
- `airtable-api-backup.js` est conserve comme reference — ne pas supprimer tant que Supabase n'est pas valide en prod
- Les IDs Supabase sont des UUID (pas des strings Airtable type `recXXX`). Le champ `airtable_id` dans chaque table permet de retrouver la correspondance
- Le champ `tailles` est un `text[]` PostgreSQL (array natif), pas une string CSV
