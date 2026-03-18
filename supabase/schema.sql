-- ============================================================
-- BOTH EQUIPMNT — Schéma Supabase (PostgreSQL)
-- Migration depuis Airtable
-- ============================================================

-- 1. CLUBS
CREATE TABLE clubs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id text UNIQUE,                          -- mapping migration
  nom         text NOT NULL,
  email       text,                                  -- email principal
  emails      text,                                  -- emails secondaires (séparés par virgule)
  logo_url    text DEFAULT '',
  minimum_commande  numeric(10,2) DEFAULT 0,
  active_minimum    boolean DEFAULT false,
  frais_livraison   numeric(10,2) DEFAULT 0,
  admin             boolean DEFAULT false,
  derniere_connexion timestamptz,
  dernier_email_connexion text,
  created_at  timestamptz DEFAULT now()
);

-- 2. PRODUITS
CREATE TABLE produits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id     text UNIQUE,
  nom             text NOT NULL,
  club            text DEFAULT '',                   -- nom du club (filtre catalogue)
  type            text DEFAULT '',                   -- Performance, Lifestyle, Maillots, etc.
  gamme           text DEFAULT '',                   -- T-shirts, Hoodie, Vestes, etc.
  couleur         text DEFAULT '',
  matiere         text DEFAULT '',                   -- Coton, Polyester
  genre           text DEFAULT '',                   -- Unisex, Femmes, Enfants, Bébé
  tailles         text[] DEFAULT '{}',               -- ex: {'S','M','L','XL'}
  description     text DEFAULT '',

  -- Fournisseur & Fabrication
  lien_fournisseur text DEFAULT '',
  impression       text DEFAULT '',                  -- nom du visuel/marquage
  produit_asie     boolean DEFAULT false,

  -- Prix & Coûts
  prix_ht_textile   numeric(10,2) DEFAULT 0,
  cout_impression   numeric(10,2) DEFAULT 0,
  prix_vente_club   numeric(10,2) DEFAULT 0,
  taux_impots       numeric(5,2) DEFAULT 0.20,

  -- Vestiaire
  image_url         text DEFAULT '',
  visible_vestiaire boolean DEFAULT true,
  personnalisation  text DEFAULT 'Aucune',           -- 'Aucune', 'Nom', 'Numero', 'Nom + Numero'
  min_quantite      integer DEFAULT 0,
  max_quantite      integer DEFAULT 0,
  groupe_stock      text DEFAULT '',                 -- ex: 'CAGOULE-01'
  stock_groupe      integer DEFAULT 0,
  expire            boolean DEFAULT false,

  -- Suivi
  cout_fini         boolean DEFAULT false,
  ajout_termine     boolean DEFAULT false,
  ajout_vestiaire   boolean DEFAULT false,

  created_at      timestamptz DEFAULT now()
);

-- 3. COMMANDES
CREATE TABLE commandes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id     text UNIQUE,
  reference       text NOT NULL,
  club_id         uuid REFERENCES clubs(id) ON DELETE SET NULL,
  statut          text DEFAULT '🟡 EN ATTENTE DE PAIEMENT',
  vu              text DEFAULT '❌',
  total           numeric(10,2) DEFAULT 0,
  nb_articles     integer DEFAULT 0,
  frais_livraison numeric(10,2) DEFAULT 0,
  date            timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

-- 4. LIGNES COMMANDES
CREATE TABLE lignes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id     text UNIQUE,
  commande_id     uuid REFERENCES commandes(id) ON DELETE CASCADE,
  produit_id      uuid REFERENCES produits(id) ON DELETE SET NULL,
  taille          text DEFAULT '',
  quantite        integer DEFAULT 0,
  nom_perso       text DEFAULT '',
  numero_perso    text DEFAULT '',
  created_at      timestamptz DEFAULT now()
);

-- 5. SUIVI PRODUCTION
CREATE TABLE suivi_production (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id     text UNIQUE,
  commande_id     uuid REFERENCES commandes(id) ON DELETE CASCADE,
  etape           text DEFAULT '',
  statut          text DEFAULT '',
  date_etape      timestamptz,
  notes           text DEFAULT '',
  created_at      timestamptz DEFAULT now()
);

-- 6. PRODUCTION LINES (suivi de production agrégé)
CREATE TABLE production_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produit_id          uuid REFERENCES produits(id) ON DELETE SET NULL,
  club_id             uuid REFERENCES clubs(id) ON DELETE SET NULL,
  taille              text DEFAULT '',
  quantite            integer DEFAULT 0,
  personnalisation    text DEFAULT '',          -- numéro ou nom (vide si aucune)
  est_produit_asie    boolean DEFAULT false,

  -- Statuts produits classiques (null si produit Asie)
  statut_textile      text DEFAULT 'a_commander',  -- a_commander, en_panier, commande, recu, verifie
  statut_dtf          text DEFAULT 'a_commander',  -- a_commander, en_panier, commande, recu, verifie

  -- Statut produits Asie (null si produit classique)
  statut_asie         text,                        -- a_commander, en_panier, commande, recu, verifie

  -- Production (null si produit Asie)
  statut_production   text DEFAULT 'a_produire',   -- a_produire, en_cours, termine

  -- Livraison (tous les produits)
  statut_livraison    text DEFAULT 'a_livrer',     -- a_livrer, livre

  fournisseur         text DEFAULT '',             -- où le produit a réellement été acheté
  notes               text DEFAULT '',
  date_creation       timestamptz DEFAULT now(),
  date_modification   timestamptz DEFAULT now()
);

-- 7. LIAISON PRODUCTION <-> COMMANDES
CREATE TABLE production_lines_commandes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_line_id  uuid REFERENCES production_lines(id) ON DELETE CASCADE,
  commande_id         uuid REFERENCES commandes(id) ON DELETE CASCADE,
  ligne_commande_id   uuid REFERENCES lignes(id) ON DELETE SET NULL,
  quantite            integer DEFAULT 0,
  created_at          timestamptz DEFAULT now()
);

-- 8. DEMANDES
CREATE TABLE demandes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id text UNIQUE,
  club_id     uuid REFERENCES clubs(id) ON DELETE SET NULL,
  objet       text DEFAULT '',
  message     text DEFAULT '',
  statut      text DEFAULT 'Nouvelle',
  reponse     text DEFAULT '',
  date        timestamptz DEFAULT now(),
  created_at  timestamptz DEFAULT now()
);

-- 9. SETTINGS (clé/valeur pour configuration globale)
CREATE TABLE settings (
  key   text PRIMARY KEY,
  value text NOT NULL DEFAULT ''
);

-- Valeurs par défaut RIB
INSERT INTO settings (key, value) VALUES
  ('rib_beneficiaire', 'BOTH EQUIPMNT'),
  ('rib_iban', 'FR76 1451 8292 6705 3640 9504 091'),
  ('rib_bic', 'FTNOFRP1XXX');

-- ============================================================
-- INDEX
-- ============================================================
CREATE INDEX idx_produits_club ON produits(club);
CREATE INDEX idx_produits_visible ON produits(visible_vestiaire) WHERE visible_vestiaire = true;
CREATE INDEX idx_commandes_club ON commandes(club_id);
CREATE INDEX idx_commandes_ref ON commandes(reference);
CREATE INDEX idx_lignes_commande ON lignes(commande_id);
CREATE INDEX idx_lignes_produit ON lignes(produit_id);
CREATE INDEX idx_suivi_commande ON suivi_production(commande_id);
CREATE INDEX idx_demandes_club ON demandes(club_id);
CREATE INDEX idx_clubs_email ON clubs(email);
CREATE INDEX idx_prod_lines_produit ON production_lines(produit_id);
CREATE INDEX idx_prod_lines_club ON production_lines(club_id);
CREATE INDEX idx_prod_lines_statut_textile ON production_lines(statut_textile);
CREATE INDEX idx_prod_lines_statut_dtf ON production_lines(statut_dtf);
CREATE INDEX idx_prod_lines_statut_asie ON production_lines(statut_asie);
CREATE INDEX idx_prod_lines_statut_livraison ON production_lines(statut_livraison);
CREATE INDEX idx_prod_lines_cmd_line ON production_lines_commandes(production_line_id);
CREATE INDEX idx_prod_lines_cmd_commande ON production_lines_commandes(commande_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- Politique permissive pour l'instant (anon key = full access)
-- Sera restreint en phase 2 avec auth
-- ============================================================
ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE produits ENABLE ROW LEVEL SECURITY;
ALTER TABLE commandes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lignes ENABLE ROW LEVEL SECURITY;
ALTER TABLE suivi_production ENABLE ROW LEVEL SECURITY;
ALTER TABLE demandes ENABLE ROW LEVEL SECURITY;

-- Policies anon = tout autoriser (phase 1)
CREATE POLICY "anon_all" ON clubs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON produits FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON commandes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON lignes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON suivi_production FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON demandes FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE production_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_lines_commandes ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON production_lines FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON production_lines_commandes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON settings FOR ALL USING (true) WITH CHECK (true);
