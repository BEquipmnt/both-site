-- ============================================================
-- BOTH EQUIPMNT — Migration Phase 2
-- Nouveaux champs produits (formulaire complet)
-- À exécuter dans le SQL Editor de Supabase
-- ============================================================

-- Informations générales
ALTER TABLE produits ADD COLUMN IF NOT EXISTS gamme text DEFAULT '';
ALTER TABLE produits ADD COLUMN IF NOT EXISTS couleur text DEFAULT '';
ALTER TABLE produits ADD COLUMN IF NOT EXISTS matiere text DEFAULT '';
ALTER TABLE produits ADD COLUMN IF NOT EXISTS genre text DEFAULT '';

-- Fournisseur & Fabrication
ALTER TABLE produits ADD COLUMN IF NOT EXISTS lien_fournisseur text DEFAULT '';
ALTER TABLE produits ADD COLUMN IF NOT EXISTS impression text DEFAULT '';
ALTER TABLE produits ADD COLUMN IF NOT EXISTS produit_asie boolean DEFAULT false;

-- Prix & Coûts
ALTER TABLE produits ADD COLUMN IF NOT EXISTS prix_ht_textile numeric(10,2) DEFAULT 0;
ALTER TABLE produits ADD COLUMN IF NOT EXISTS cout_impression numeric(10,2) DEFAULT 0;
ALTER TABLE produits ADD COLUMN IF NOT EXISTS taux_impots numeric(5,2) DEFAULT 0.20;

-- Suivi
ALTER TABLE produits ADD COLUMN IF NOT EXISTS cout_fini boolean DEFAULT false;
ALTER TABLE produits ADD COLUMN IF NOT EXISTS ajout_termine boolean DEFAULT false;
ALTER TABLE produits ADD COLUMN IF NOT EXISTS ajout_vestiaire boolean DEFAULT false;
