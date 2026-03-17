#!/usr/bin/env node
// ============================================================
// BOTH EQUIPMNT — Script de migration Airtable → Supabase
// Usage: node supabase/migrate.js
//
// Pré-requis :
//   1. Exécuter schema.sql dans Supabase (SQL Editor)
//   2. Définir les variables d'environnement :
//      AIRTABLE_TOKEN, AIRTABLE_BASE_ID,
//      SUPABASE_URL, SUPABASE_SERVICE_KEY
//
// Note : utilise SUPABASE_SERVICE_KEY (pas anon) pour bypass RLS
// ============================================================

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appU4TaThJWm3A7qJ';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!AIRTABLE_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Variables requises : AIRTABLE_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const AIRTABLE_API = 'https://api.airtable.com/v0';

// Table IDs Airtable
const TABLES = {
  clubs: 'tblsBiicwKqdFe7h5',
  produits: 'tbl8ri4tUfg1TH659',
  commandes: 'tbloz7JkktaBoHWie',
  lignes: 'tblWuqefKcUPd4I22',
  suivi: 'tblHZqgLG5tvGYwut',
  demandes: 'tbl3vwZcFKIUYfvRk'
};

// ============================================================
// HELPERS
// ============================================================

async function airtableFetchAll(tableId) {
  let all = [];
  let offset = null;
  do {
    let url = `${AIRTABLE_API}/${BASE_ID}/${tableId}`;
    const qs = [];
    if (offset) qs.push(`offset=${offset}`);
    if (qs.length) url += '?' + qs.join('&');

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    });
    if (!r.ok) {
      if (r.status === 429) {
        console.log('  Rate limited, waiting 2s...');
        await new Promise(res => setTimeout(res, 2000));
        continue;
      }
      throw new Error(`Airtable ${r.status}: ${await r.text()}`);
    }
    const data = await r.json();
    all = all.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  return all;
}

async function supabaseInsert(table, rows) {
  if (!rows.length) return [];
  // Insert par batchs de 500
  const results = [];
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(batch)
    });
    if (!r.ok) {
      const err = await r.text();
      throw new Error(`Supabase insert ${table} error: ${r.status} ${err}`);
    }
    const data = await r.json();
    results.push(...data);
  }
  return results;
}

// ============================================================
// MIGRATION
// ============================================================

async function migrate() {
  console.log('=== MIGRATION AIRTABLE → SUPABASE ===\n');

  // ----------------------------------------------------------
  // 1. CLUBS
  // ----------------------------------------------------------
  console.log('1/6  Chargement Clubs depuis Airtable...');
  const atClubs = await airtableFetchAll(TABLES.clubs);
  console.log(`     ${atClubs.length} clubs trouvés`);

  const clubRows = atClubs.map(r => ({
    airtable_id: r.id,
    nom: r.fields['Nom'] || '',
    email: r.fields['email'] || '',
    emails: r.fields['Emails'] || '',
    logo_url: r.fields['Logo Club URL'] || '',
    minimum_commande: parseFloat(r.fields['Minimum Commande']) || 0,
    active_minimum: r.fields['Active Minimum'] || false,
    frais_livraison: parseFloat(r.fields['Frais Livraison']) || 0,
    admin: r.fields['Admin'] || false,
    derniere_connexion: r.fields['Dernière connexion'] || null,
    dernier_email_connexion: r.fields['Dernier email connexion'] || ''
  }));

  const clubs = await supabaseInsert('clubs', clubRows);
  console.log(`     ✓ ${clubs.length} clubs migrés`);

  // Mapping airtable_id → supabase uuid
  const clubMap = {};
  clubs.forEach(c => { clubMap[c.airtable_id] = c.id; });

  // ----------------------------------------------------------
  // 2. PRODUITS
  // ----------------------------------------------------------
  console.log('2/6  Chargement Produits depuis Airtable...');
  const atProduits = await airtableFetchAll(TABLES.produits);
  console.log(`     ${atProduits.length} produits trouvés`);

  const produitRows = atProduits.map(r => {
    let tailles = r.fields['Tailles disponibles'] || [];
    // Airtable peut renvoyer un string ou un array
    if (typeof tailles === 'string') {
      tailles = tailles.split(',').map(t => t.trim()).filter(Boolean);
    }
    return {
      airtable_id: r.id,
      nom: r.fields['Nom'] || '',
      image_url: r.fields['Image URL'] || '',
      prix_vente_club: parseFloat(r.fields['Prix Vente Club']) || 0,
      tailles: tailles,
      personnalisation: r.fields['Personnalisation'] || 'Aucune',
      type: r.fields['Type'] || '',
      description: r.fields['Description'] || '',
      min_quantite: parseInt(r.fields['Min Quantité']) || 0,
      max_quantite: parseInt(r.fields['Max Quantité']) || 0,
      groupe_stock: r.fields['Groupe Stock'] || '',
      stock_groupe: parseInt(r.fields['Stock Groupe']) || 0,
      club: r.fields['Club'] || '',
      visible_vestiaire: r.fields['Visible Vestiaire'] || false,
      expire: r.fields['Expiré'] || false
    };
  });

  const produits = await supabaseInsert('produits', produitRows);
  console.log(`     ✓ ${produits.length} produits migrés`);

  const produitMap = {};
  produits.forEach(p => { produitMap[p.airtable_id] = p.id; });

  // ----------------------------------------------------------
  // 3. COMMANDES
  // ----------------------------------------------------------
  console.log('3/6  Chargement Commandes depuis Airtable...');
  const atCommandes = await airtableFetchAll(TABLES.commandes);
  console.log(`     ${atCommandes.length} commandes trouvées`);

  const commandeRows = atCommandes.map(r => {
    const clubLink = r.fields['Club'];
    const atClubId = Array.isArray(clubLink) ? clubLink[0] : null;
    return {
      airtable_id: r.id,
      reference: r.fields['Référence'] || '',
      club_id: atClubId ? (clubMap[atClubId] || null) : null,
      statut: r.fields['Statut'] || '🟡 EN ATTENTE DE PAIEMENT',
      vu: r.fields['Vu'] || '❌',
      total: parseFloat(r.fields['Total']) || 0,
      nb_articles: parseInt(r.fields['Nb Articles']) || 0,
      frais_livraison: parseFloat(r.fields['Frais Livraison']) || 0,
      date: r.fields['Date'] || new Date().toISOString()
    };
  });

  const commandes = await supabaseInsert('commandes', commandeRows);
  console.log(`     ✓ ${commandes.length} commandes migrées`);

  const commandeMap = {};
  commandes.forEach(c => { commandeMap[c.airtable_id] = c.id; });

  // ----------------------------------------------------------
  // 4. LIGNES
  // ----------------------------------------------------------
  console.log('4/6  Chargement Lignes depuis Airtable...');
  const atLignes = await airtableFetchAll(TABLES.lignes);
  console.log(`     ${atLignes.length} lignes trouvées`);

  const ligneRows = atLignes.map(r => {
    const cmdLink = r.fields['Commande'];
    const prodLink = r.fields['Produit'];
    const atCmdId = Array.isArray(cmdLink) ? cmdLink[0] : null;
    const atProdId = Array.isArray(prodLink) ? prodLink[0] : null;
    return {
      airtable_id: r.id,
      commande_id: atCmdId ? (commandeMap[atCmdId] || null) : null,
      produit_id: atProdId ? (produitMap[atProdId] || null) : null,
      taille: r.fields['Taille'] || '',
      quantite: parseInt(r.fields['Quantité']) || 0,
      nom_perso: r.fields['Nom Personnalisation'] || '',
      numero_perso: r.fields['Numéro Personnalisation'] || ''
    };
  });

  const lignes = await supabaseInsert('lignes', ligneRows);
  console.log(`     ✓ ${lignes.length} lignes migrées`);

  // ----------------------------------------------------------
  // 5. SUIVI PRODUCTION
  // ----------------------------------------------------------
  console.log('5/6  Chargement Suivi Production depuis Airtable...');
  const atSuivi = await airtableFetchAll(TABLES.suivi);
  console.log(`     ${atSuivi.length} suivis trouvés`);

  const suiviRows = atSuivi.map(r => {
    const cmdLink = r.fields['Commande'];
    const atCmdId = Array.isArray(cmdLink) ? cmdLink[0] : null;
    return {
      airtable_id: r.id,
      commande_id: atCmdId ? (commandeMap[atCmdId] || null) : null,
      etape: r.fields['Étape'] || r.fields['Etape'] || '',
      statut: r.fields['Statut'] || '',
      date_etape: r.fields['Date'] || r.fields['Date étape'] || null,
      notes: r.fields['Notes'] || ''
    };
  });

  const suivis = await supabaseInsert('suivi_production', suiviRows);
  console.log(`     ✓ ${suivis.length} suivis migrés`);

  // ----------------------------------------------------------
  // 6. DEMANDES
  // ----------------------------------------------------------
  console.log('6/6  Chargement Demandes depuis Airtable...');
  const atDemandes = await airtableFetchAll(TABLES.demandes);
  console.log(`     ${atDemandes.length} demandes trouvées`);

  const demandeRows = atDemandes.map(r => {
    const clubLink = r.fields['Club'];
    const atClubId = Array.isArray(clubLink) ? clubLink[0] : null;
    return {
      airtable_id: r.id,
      club_id: atClubId ? (clubMap[atClubId] || null) : null,
      objet: r.fields['Objet'] || '',
      message: r.fields['Message'] || '',
      statut: r.fields['Statut'] || 'Nouvelle',
      reponse: r.fields['Réponse'] || '',
      date: r.fields['Date'] || new Date().toISOString()
    };
  });

  const demandes = await supabaseInsert('demandes', demandeRows);
  console.log(`     ✓ ${demandes.length} demandes migrées`);

  // ----------------------------------------------------------
  // RÉSUMÉ
  // ----------------------------------------------------------
  console.log('\n=== MIGRATION TERMINÉE ===');
  console.log(`  Clubs       : ${clubs.length}`);
  console.log(`  Produits    : ${produits.length}`);
  console.log(`  Commandes   : ${commandes.length}`);
  console.log(`  Lignes      : ${lignes.length}`);
  console.log(`  Suivi Prod  : ${suivis.length}`);
  console.log(`  Demandes    : ${demandes.length}`);
  console.log(`\nMappings conservés via champ airtable_id dans chaque table.`);
}

migrate().catch(err => {
  console.error('\n❌ ERREUR MIGRATION:', err);
  process.exit(1);
});
