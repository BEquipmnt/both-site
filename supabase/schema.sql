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
  image_url       text DEFAULT '',
  prix_vente_club numeric(10,2) DEFAULT 0,
  tailles         text[] DEFAULT '{}',               -- ex: {'S','M','L','XL'}
  personnalisation text DEFAULT 'Aucune',            -- 'Aucune', 'Nom', 'Numero', 'Nom + Numero'
  type            text DEFAULT '',                   -- catégorie
  description     text DEFAULT '',
  min_quantite    integer DEFAULT 0,
  max_quantite    integer DEFAULT 0,
  groupe_stock    text DEFAULT '',                   -- ex: 'CAGOULE-01'
  stock_groupe    integer DEFAULT 0,
  club            text DEFAULT '',                   -- nom du club (filtre catalogue)
  visible_vestiaire boolean DEFAULT true,
  expire          boolean DEFAULT false,
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

-- 6. DEMANDES
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
