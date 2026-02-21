# CLAUDE.md — Both Equipmnt

## Projet

Site vitrine + portail B2B pour **BOTH EQUIPMNT**, equipementier sportif.
Clubs de sport se connectent au "Vestiaire" pour commander des tenues personnalisees.

## Stack

- **Hosting** : Netlify (static site + serverless functions)
- **Backend** : 2 Netlify Functions (Node.js, esbuild)
- **Bases de donnees** :
  - **Airtable** : donnees transactionnelles (clubs, produits, commandes, lignes, demandes)
  - **Notion** : contenu editorial (actualites, portfolio, partenaires)
- **Frontend** : HTML/CSS/JS vanilla (pas de framework, pas de build)
- **Fonts** : Google Fonts (Oswald + Work Sans)
- **Images** : hebergees sur Imgur, Google Drive, Airtable CDN

## Architecture des fichiers

```
/
├── index.html                 # Page vitrine principale (hero, vision, actus, portfolio, contact, partenaires)
├── vestiaire.html             # Portail B2B club (login, catalogue, panier, commandes, demandes)
├── vision.html                # Page "A propos"
├── portfolio.html             # Liste de tous les projets
├── news.html                  # Liste de toutes les actualites
├── projet-detail.html         # Detail d'un projet (rendu blocks Notion)
├── actualite-detail.html      # Detail d'une actualite
├── mentions-legales.html      # Mentions legales & CGV
├── robots.txt / sitemap.xml   # SEO
├── netlify.toml               # Config Netlify (functions path, esbuild)
└── netlify/functions/
    ├── airtable-api.js        # API Airtable (clubs, produits, commandes, demandes)
    └── notion-api.js          # API Notion (actus, portfolio, partenaires, blocks)
```

## Variables d'environnement (Netlify Dashboard)

```
AIRTABLE_TOKEN          # Bearer token Airtable
AIRTABLE_BASE_ID        # ID de la base Airtable
AIRTABLE_TABLE_DEMANDES # (optionnel) ID table Demandes
NOTION_KEY              # Bearer token Notion (ntn_...)
NOTION_DB_ACTUALITES    # ID database Notion actualites
NOTION_DB_PORTFOLIO     # ID database Notion portfolio
NOTION_DB_PARTNERS      # ID database Notion partenaires
```

## Netlify Functions — Endpoints

### airtable-api.js (`/.netlify/functions/airtable-api`)

Tables Airtable (IDs hardcodes) :
- `tblsBiicwKqdFe7h5` — Clubs
- `tbl8ri4tUfg1TH659` — Produits
- `tbloz7JkktaBoHWie` — Commandes
- `tblWuqefKcUPd4I22` — Lignes

**GET :**
| Action | Params | Description |
|--------|--------|-------------|
| `getClub` | `email` | Auth par email (champ unique ou liste separee par virgules) |
| `getCatalogue` | `clubId`, `clubNom` | Produits visibles pour le club + `dejaCommande` par produit |
| `getOrders` | `clubId` | Historique commandes du club |
| `getDemandes` | `clubId` | Demandes/reclamations du club |

**POST :**
| Action | Body | Description |
|--------|------|-------------|
| `createOrder` | `{ clubId, clubNom, lignes, total }` | Cree commande + lignes dans Airtable |
| `createDemande` | `{ clubId, objet, message }` | Cree une demande |

Helpers :
- `airtableRequestAll(table)` : pagination automatique (offset) pour recuperer tous les records
- `getDejaCommande(clubId)` : somme des quantites deja commandees par produit

### notion-api.js (`/.netlify/functions/notion-api`)

**GET :**
| Action | Params | Description |
|--------|--------|-------------|
| `getNews` | `id` (opt) | Toutes les actus publiees, ou une seule par ID |
| `getPortfolio` | `id` (opt), `all` (opt) | Projets "mis en avant" ou tous, ou un seul par ID |
| `getProjectBlocks` | `id` | Projet + blocks Notion (paragraphes, images, colonnes...) |
| `getPartners` | — | Logos partenaires |

Helper `richTextToHtml()` : convertit le rich text Notion en HTML (bold, italic, underline, liens, couleurs).
Helper `mapBlock()` : convertit les blocks Notion en JSON simplifie (heading, paragraph, image, list, quote, video, callout, column_list).

## Vestiaire — Concepts cles

### Authentification
Login par email (pas de mot de passe). L'email est cherche dans la table Clubs (champ `Email` unique + champ `Emails` multi-valeur separe par virgules).

### State global `S`
```js
const S = {
  club: null,           // { id, nom, email, logoClub, minCommande, activeMin }
  products: [],         // catalogue charge depuis Airtable
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
1. Login email → `getClub`
2. Catalogue → `getCatalogue` (inclut `dejaCommande`)
3. Modal produit → choix tailles/quantites + perso optionnelle
4. Ajout panier → validation min/max
5. Validation commande → `createOrder` (cree Commande + Lignes Airtable)
6. Confirmation → affiche ref + coordonnees bancaires (IBAN/BIC) pour virement

## Site vitrine (index.html)

Charge le contenu dynamique depuis Notion au load :
- `loadNews()` → section actualites (scroll horizontal)
- `loadPortfolio()` → grille masonry (4 projets mis en avant)
- `loadPartners()` → logos partenaires

Le bouton "Mon Vestiaire" redirige vers `/vestiaire.html`.
Le formulaire contact utilise Netlify Forms (`data-netlify="true"`).

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
```

## Points d'attention

- Les IDs de tables Airtable sont hardcodes dans `airtable-api.js`
- La variable CSS `--red` est en realite du jaune/or (#ffd700), pas du rouge
- Le champ `personnalisable` dans le JS correspond au champ Airtable `Personnalisation`
- Les images produits peuvent etre une URL unique ou une liste separee par virgules
- `airtableRequestAll()` gere la pagination Airtable (max 100 records par requete, utilise `offset`)
- Le formulaire contact est un Netlify Form (soumis en POST sur `/`)
- Pas de base de donnees propre — tout est dans Airtable et Notion
