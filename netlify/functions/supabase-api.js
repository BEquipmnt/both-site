// ============================================================
// BOTH EQUIPMNT — Netlify Function Supabase
// Remplace airtable-api.js — mêmes actions, même format de réponse
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

// ============================================================
// HELPER: Requête Supabase REST
// ============================================================
async function sb(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const r = await fetch(url, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
      ...options.headers
    }
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Supabase ${r.status}: ${err}`);
  }
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

// Shorthand GET avec query string
async function sbGet(table, query = '') {
  return sb(`${table}?${query}`);
}

// Shorthand POST
async function sbPost(table, data) {
  return sb(table, {
    method: 'POST',
    body: JSON.stringify(data),
    prefer: 'return=representation'
  });
}

// Shorthand PATCH
async function sbPatch(table, query, data) {
  return sb(`${table}?${query}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
    prefer: 'return=minimal'
  });
}

// ============================================================
// GET CLUB (login)
// ============================================================
async function getClub(email) {
  try {
    const emailLower = email.toLowerCase();

    // Chercher dans le champ email principal (case insensitive)
    const clubs = await sbGet('clubs', 'select=*');

    // Filtrer manuellement (comme Airtable) pour gérer multi-emails
    const club = clubs.find(c => {
      if (c.email && c.email.toLowerCase() === emailLower) return true;
      if (c.emails) {
        const list = c.emails.split(',').map(e => e.trim().toLowerCase());
        if (list.includes(emailLower)) return true;
      }
      return false;
    });

    if (!club) return { club: null };

    // Enregistrer la connexion (non bloquant)
    sbPatch('clubs', `id=eq.${club.id}`, {
      derniere_connexion: new Date().toISOString(),
      dernier_email_connexion: email
    }).catch(err => console.error('Erreur maj connexion:', err));

    return {
      club: {
        id: club.id,
        nom: club.nom || '',
        email: club.email || '',
        logoClub: club.logo_url || '',
        minCommande: parseFloat(club.minimum_commande) || 0,
        activeMin: club.active_minimum || false,
        fraisLivraison: parseFloat(club.frais_livraison) || 0,
        admin: club.admin || false
      }
    };
  } catch (error) {
    console.error('getClub error:', error);
    return { error: error.message };
  }
}

// ============================================================
// HELPER: Quantités déjà commandées par le club
// ============================================================
async function getDejaCommande(clubId) {
  // Récupérer les commandes du club
  const commandes = await sbGet('commandes', `select=id&club_id=eq.${clubId}`);
  if (!commandes.length) return {};

  const commandeIds = commandes.map(c => c.id);

  // Récupérer les lignes de ces commandes
  const lignes = await sbGet('lignes',
    `select=produit_id,quantite&commande_id=in.(${commandeIds.join(',')})`
  );

  const dejaCommande = {};
  lignes.forEach(l => {
    if (l.produit_id) {
      dejaCommande[l.produit_id] = (dejaCommande[l.produit_id] || 0) + (l.quantite || 0);
    }
  });

  return dejaCommande;
}

// ============================================================
// GET CATALOGUE
// ============================================================
async function getCatalogue(clubId, clubNom) {
  try {
    const [allProduits, dejaCommande] = await Promise.all([
      sbGet('produits', `select=*&visible_vestiaire=eq.true&expire=eq.false&club=eq.${encodeURIComponent(clubNom)}`),
      getDejaCommande(clubId)
    ]);

    const products = allProduits.map(r => ({
      id: r.id,
      nom: r.nom || '',
      image: r.image_url || '',
      prix: parseFloat(r.prix_vente_club) || 0,
      tailles: r.tailles || [],
      personnalisation: r.personnalisation || 'Aucune',
      categorie: r.type || '',
      description: r.description || '',
      minQuantite: r.min_quantite || 0,
      maxQuantite: r.max_quantite || 0,
      groupeStock: r.groupe_stock || '',
      stockGroupe: r.stock_groupe || 0,
      dejaCommande: dejaCommande[r.id] || 0
    }));

    return { products };
  } catch (error) {
    console.error('getCatalogue error:', error);
    return { error: error.message };
  }
}

// ============================================================
// GET ORDERS
// ============================================================
async function getOrders(clubId) {
  try {
    const commandes = await sbGet('commandes',
      `select=*&club_id=eq.${clubId}&order=date.desc`
    );

    const orders = commandes.map(r => ({
      id: r.id,
      ref: r.reference || '',
      date: r.date ? new Date(r.date).toLocaleDateString('fr-FR') : '',
      nbArticles: r.nb_articles || 0,
      total: parseFloat(r.total) || 0,
      statut: r.statut || '🟡 EN ATTENTE DE PAIEMENT'
    }));

    return { orders };
  } catch (error) {
    console.error('getOrders error:', error);
    return { error: error.message };
  }
}

// ============================================================
// GET ALL ORDERS (admin)
// ============================================================
async function getAllOrders() {
  try {
    const [commandes, clubs] = await Promise.all([
      sbGet('commandes', 'select=*&order=date.desc'),
      sbGet('clubs', 'select=id,nom,email,frais_livraison')
    ]);

    const clubsMap = {};
    clubs.forEach(c => {
      clubsMap[c.id] = { nom: c.nom, email: c.email, fraisLivraison: parseFloat(c.frais_livraison) || 0 };
    });

    const orders = commandes.map(r => {
      const club = r.club_id ? clubsMap[r.club_id] : { nom: '—', email: '', fraisLivraison: 0 };
      return {
        id: r.id,
        ref: r.reference || '',
        date: r.date ? new Date(r.date).toLocaleDateString('fr-FR') : '',
        nbArticles: r.nb_articles || 0,
        total: parseFloat(r.total) || 0,
        statut: r.statut || '🟡 EN ATTENTE DE PAIEMENT',
        clubNom: club ? club.nom : '—',
        clubEmail: club ? club.email : '',
        fraisLivraison: club ? club.fraisLivraison : 0
      };
    });

    return { orders };
  } catch (error) {
    console.error('getAllOrders error:', error);
    return { error: error.message };
  }
}

// ============================================================
// GET ORDER DETAIL (admin — pour facture PDF)
// ============================================================
async function getOrderDetail(orderId) {
  try {
    // Récupérer la commande
    const commandes = await sbGet('commandes', `select=*&id=eq.${orderId}`);
    if (!commandes.length) return { error: 'Commande introuvable' };
    const commande = commandes[0];

    // Récupérer club et lignes en parallèle
    const [clubArr, lignes] = await Promise.all([
      commande.club_id
        ? sbGet('clubs', `select=nom,email&id=eq.${commande.club_id}`)
        : Promise.resolve([]),
      sbGet('lignes', `select=*&commande_id=eq.${orderId}`)
    ]);

    const clubInfo = clubArr.length ? clubArr[0] : { nom: '—', email: '' };

    // Récupérer les produits référencés
    const produitIds = [...new Set(lignes.map(l => l.produit_id).filter(Boolean))];
    const produitsMap = {};
    if (produitIds.length) {
      const produits = await sbGet('produits',
        `select=id,nom,prix_vente_club&id=in.(${produitIds.join(',')})`
      );
      produits.forEach(p => {
        produitsMap[p.id] = { nom: p.nom, prix: parseFloat(p.prix_vente_club) || 0 };
      });
    }

    const lignesDetail = lignes.map(l => {
      const prod = l.produit_id ? produitsMap[l.produit_id] : { nom: '—', prix: 0 };
      return {
        produit: prod ? prod.nom : '—',
        prixUnitaire: prod ? prod.prix : 0,
        taille: l.taille || '',
        quantite: l.quantite || 0,
        nomPerso: l.nom_perso || '',
        numPerso: l.numero_perso || ''
      };
    });

    return {
      order: {
        id: commande.id,
        ref: commande.reference || '',
        date: commande.date ? new Date(commande.date).toLocaleDateString('fr-FR') : '',
        total: parseFloat(commande.total) || 0,
        nbArticles: commande.nb_articles || 0,
        statut: commande.statut || '',
        fraisLivraison: parseFloat(commande.frais_livraison) || 0,
        clubNom: clubInfo.nom,
        clubEmail: clubInfo.email
      },
      lignes: lignesDetail
    };
  } catch (error) {
    console.error('getOrderDetail error:', error);
    return { error: error.message };
  }
}

// ============================================================
// CREATE ORDER
// ============================================================
async function createOrder(payload) {
  try {
    const ref = payload.orderRef || `CMD-${(payload.clubNom || 'CLUB').toUpperCase().replace(/[^A-Z0-9]/g, '')}-${Date.now().toString().slice(-6)}`;

    // Vérifier doublon
    const existing = await sbGet('commandes', `select=id&reference=eq.${encodeURIComponent(ref)}`);
    if (existing.length > 0) {
      return { success: true, orderRef: ref, commandeId: existing[0].id, duplicate: true };
    }

    const totalArticles = payload.nbArticles || (payload.lignes ? payload.lignes.reduce((sum, l) => sum + l.quantite, 0) : 0);

    // Créer la commande
    const result = await sbPost('commandes', {
      reference: ref,
      club_id: payload.clubId,
      statut: '🟡 EN ATTENTE DE PAIEMENT',
      vu: '❌',
      total: payload.total,
      nb_articles: totalArticles,
      frais_livraison: payload.fraisLivraison || 0
    });

    const commandeId = result[0].id;

    // Créer les lignes si incluses
    if (payload.lignes && payload.lignes.length > 0) {
      try {
        const ligneRows = payload.lignes.map(l => ({
          commande_id: commandeId,
          produit_id: l.productId,
          taille: l.taille,
          quantite: l.quantite,
          nom_perso: l.nomPerso || '',
          numero_perso: l.numPerso || ''
        }));
        await sbPost('lignes', ligneRows);
      } catch (lignesErr) {
        console.error('Lignes creation error (commande créée OK):', lignesErr);
        return { success: true, orderRef: ref, commandeId, lignesError: true };
      }
    }

    return { success: true, orderRef: ref, commandeId };
  } catch (error) {
    console.error('createOrder error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// CREATE LIGNES (envoi par chunks séparés)
// ============================================================
async function createLignes(payload) {
  try {
    const { commandeId, lignes } = payload;
    if (!commandeId || !Array.isArray(lignes) || !lignes.length) {
      return { success: false, error: 'commandeId et lignes requis' };
    }

    const ligneRows = lignes.map(l => ({
      commande_id: commandeId,
      produit_id: l.productId,
      taille: l.taille,
      quantite: l.quantite,
      nom_perso: l.nomPerso || '',
      numero_perso: l.numPerso || ''
    }));

    const results = await sbPost('lignes', ligneRows);
    return { success: true, created: results.length };
  } catch (error) {
    console.error('createLignes error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// GET DEMANDES
// ============================================================
async function getDemandes(clubId) {
  try {
    const demandes = await sbGet('demandes',
      `select=*&club_id=eq.${clubId}&order=date.desc`
    );

    return {
      demandes: demandes.map(r => ({
        id: r.id,
        objet: r.objet || '',
        message: r.message || '',
        date: r.date ? new Date(r.date).toLocaleDateString('fr-FR') : '',
        statut: r.statut || 'Nouvelle',
        reponse: r.reponse || ''
      }))
    };
  } catch (error) {
    console.error('getDemandes error:', error);
    return { error: error.message };
  }
}

// ============================================================
// CREATE DEMANDE
// ============================================================
async function createDemande(payload) {
  try {
    await sbPost('demandes', {
      club_id: payload.clubId,
      objet: payload.objet || '',
      message: payload.message || '',
      statut: 'Nouvelle'
    });
    return { success: true };
  } catch (error) {
    console.error('createDemande error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// ADMIN: DELETE helper
// ============================================================
async function sbDelete(table, query) {
  return sb(`${table}?${query}`, {
    method: 'DELETE',
    prefer: 'return=representation'
  });
}

// ============================================================
// ADMIN: CLUBS
// ============================================================
async function adminGetClubs() {
  try {
    const clubs = await sbGet('clubs', 'select=*&order=nom.asc');
    return { clubs };
  } catch (error) {
    return { error: error.message };
  }
}

async function adminCreateClub(payload) {
  try {
    const result = await sbPost('clubs', {
      nom: payload.nom || '',
      email: payload.email || '',
      emails: payload.emails || '',
      logo_url: payload.logoUrl || '',
      minimum_commande: parseFloat(payload.minimumCommande) || 0,
      active_minimum: payload.activeMinimum || false,
      frais_livraison: parseFloat(payload.fraisLivraison) || 0,
      admin: payload.admin || false
    });
    return { success: true, club: result[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function adminUpdateClub(payload) {
  try {
    const data = {};
    if (payload.nom !== undefined) data.nom = payload.nom;
    if (payload.email !== undefined) data.email = payload.email;
    if (payload.emails !== undefined) data.emails = payload.emails;
    if (payload.logoUrl !== undefined) data.logo_url = payload.logoUrl;
    if (payload.minimumCommande !== undefined) data.minimum_commande = parseFloat(payload.minimumCommande) || 0;
    if (payload.activeMinimum !== undefined) data.active_minimum = payload.activeMinimum;
    if (payload.fraisLivraison !== undefined) data.frais_livraison = parseFloat(payload.fraisLivraison) || 0;
    if (payload.admin !== undefined) data.admin = payload.admin;

    await sbPatch('clubs', `id=eq.${payload.id}`, data);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function adminDeleteClub(payload) {
  try {
    await sbDelete('clubs', `id=eq.${payload.id}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// ADMIN: PRODUITS
// ============================================================
async function adminGetProduits() {
  try {
    const produits = await sbGet('produits', 'select=*&order=nom.asc');
    return { produits };
  } catch (error) {
    return { error: error.message };
  }
}

async function adminCreateProduit(payload) {
  try {
    let tailles = payload.tailles || [];
    if (typeof tailles === 'string') {
      tailles = tailles.split(',').map(t => t.trim()).filter(Boolean);
    }
    const result = await sbPost('produits', {
      nom: payload.nom || '',
      club: payload.club || '',
      type: payload.type || '',
      gamme: payload.gamme || '',
      couleur: payload.couleur || '',
      matiere: payload.matiere || '',
      genre: payload.genre || '',
      tailles,
      description: payload.description || '',
      lien_fournisseur: payload.lienFournisseur || '',
      impression: payload.impression || '',
      produit_asie: payload.produitAsie || false,
      prix_ht_textile: parseFloat(payload.prixHtTextile) || 0,
      cout_impression: parseFloat(payload.coutImpression) || 0,
      prix_vente_club: parseFloat(payload.prixVenteClub) || 0,
      taux_impots: parseFloat(payload.tauxImpots) || 0.20,
      image_url: payload.imageUrl || '',
      visible_vestiaire: payload.visibleVestiaire !== false,
      personnalisation: payload.personnalisation || 'Aucune',
      min_quantite: parseInt(payload.minQuantite) || 0,
      max_quantite: parseInt(payload.maxQuantite) || 0,
      groupe_stock: payload.groupeStock || '',
      stock_groupe: parseInt(payload.stockGroupe) || 0,
      expire: payload.expire || false,
      cout_fini: payload.coutFini || false,
      ajout_termine: payload.ajoutTermine || false,
      ajout_vestiaire: payload.ajoutVestiaire || false
    });
    return { success: true, produit: result[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function adminUpdateProduit(payload) {
  try {
    const data = {};
    if (payload.nom !== undefined) data.nom = payload.nom;
    if (payload.club !== undefined) data.club = payload.club;
    if (payload.type !== undefined) data.type = payload.type;
    if (payload.gamme !== undefined) data.gamme = payload.gamme;
    if (payload.couleur !== undefined) data.couleur = payload.couleur;
    if (payload.matiere !== undefined) data.matiere = payload.matiere;
    if (payload.genre !== undefined) data.genre = payload.genre;
    if (payload.tailles !== undefined) {
      let t = payload.tailles;
      if (typeof t === 'string') t = t.split(',').map(s => s.trim()).filter(Boolean);
      data.tailles = t;
    }
    if (payload.description !== undefined) data.description = payload.description;
    if (payload.lienFournisseur !== undefined) data.lien_fournisseur = payload.lienFournisseur;
    if (payload.impression !== undefined) data.impression = payload.impression;
    if (payload.produitAsie !== undefined) data.produit_asie = payload.produitAsie;
    if (payload.prixHtTextile !== undefined) data.prix_ht_textile = parseFloat(payload.prixHtTextile) || 0;
    if (payload.coutImpression !== undefined) data.cout_impression = parseFloat(payload.coutImpression) || 0;
    if (payload.prixVenteClub !== undefined) data.prix_vente_club = parseFloat(payload.prixVenteClub) || 0;
    if (payload.tauxImpots !== undefined) data.taux_impots = parseFloat(payload.tauxImpots) || 0.20;
    if (payload.imageUrl !== undefined) data.image_url = payload.imageUrl;
    if (payload.visibleVestiaire !== undefined) data.visible_vestiaire = payload.visibleVestiaire;
    if (payload.personnalisation !== undefined) data.personnalisation = payload.personnalisation;
    if (payload.minQuantite !== undefined) data.min_quantite = parseInt(payload.minQuantite) || 0;
    if (payload.maxQuantite !== undefined) data.max_quantite = parseInt(payload.maxQuantite) || 0;
    if (payload.groupeStock !== undefined) data.groupe_stock = payload.groupeStock;
    if (payload.stockGroupe !== undefined) data.stock_groupe = parseInt(payload.stockGroupe) || 0;
    if (payload.expire !== undefined) data.expire = payload.expire;
    if (payload.coutFini !== undefined) data.cout_fini = payload.coutFini;
    if (payload.ajoutTermine !== undefined) data.ajout_termine = payload.ajoutTermine;
    if (payload.ajoutVestiaire !== undefined) data.ajout_vestiaire = payload.ajoutVestiaire;

    await sbPatch('produits', `id=eq.${payload.id}`, data);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function adminDeleteProduit(payload) {
  try {
    await sbDelete('produits', `id=eq.${payload.id}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// ADMIN: COMMANDES (update statut, vu, delete)
// ============================================================
async function adminUpdateOrder(payload) {
  try {
    const data = {};
    if (payload.statut !== undefined) data.statut = payload.statut;
    if (payload.vu !== undefined) data.vu = payload.vu;
    if (payload.fraisLivraison !== undefined) data.frais_livraison = parseFloat(payload.fraisLivraison) || 0;
    if (payload.total !== undefined) data.total = parseFloat(payload.total) || 0;

    await sbPatch('commandes', `id=eq.${payload.id}`, data);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function adminDeleteOrder(payload) {
  try {
    // Les lignes sont supprimées en cascade (ON DELETE CASCADE)
    await sbDelete('commandes', `id=eq.${payload.id}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// ADMIN: SUIVI PRODUCTION
// ============================================================
async function adminGetSuivi(commandeId) {
  try {
    const suivi = await sbGet('suivi_production',
      `select=*&commande_id=eq.${commandeId}&order=date_etape.asc`
    );
    return { suivi };
  } catch (error) {
    return { error: error.message };
  }
}

async function adminCreateSuivi(payload) {
  try {
    const result = await sbPost('suivi_production', {
      commande_id: payload.commandeId,
      etape: payload.etape || '',
      statut: payload.statut || '',
      date_etape: payload.dateEtape || new Date().toISOString(),
      notes: payload.notes || ''
    });
    return { success: true, suivi: result[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function adminUpdateSuivi(payload) {
  try {
    const data = {};
    if (payload.etape !== undefined) data.etape = payload.etape;
    if (payload.statut !== undefined) data.statut = payload.statut;
    if (payload.dateEtape !== undefined) data.date_etape = payload.dateEtape;
    if (payload.notes !== undefined) data.notes = payload.notes;

    await sbPatch('suivi_production', `id=eq.${payload.id}`, data);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function adminDeleteSuivi(payload) {
  try {
    await sbDelete('suivi_production', `id=eq.${payload.id}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// ADMIN: DEMANDES
// ============================================================
async function adminGetAllDemandes() {
  try {
    const [demandes, clubs] = await Promise.all([
      sbGet('demandes', 'select=*&order=date.desc'),
      sbGet('clubs', 'select=id,nom')
    ]);
    const clubsMap = {};
    clubs.forEach(c => { clubsMap[c.id] = c.nom; });

    return {
      demandes: demandes.map(d => ({
        id: d.id,
        clubNom: d.club_id ? (clubsMap[d.club_id] || '—') : '—',
        clubId: d.club_id,
        objet: d.objet || '',
        message: d.message || '',
        date: d.date ? new Date(d.date).toLocaleDateString('fr-FR') : '',
        statut: d.statut || 'Nouvelle',
        reponse: d.reponse || ''
      }))
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function adminUpdateDemande(payload) {
  try {
    const data = {};
    if (payload.statut !== undefined) data.statut = payload.statut;
    if (payload.reponse !== undefined) data.reponse = payload.reponse;

    await sbPatch('demandes', `id=eq.${payload.id}`, data);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function adminDeleteDemande(payload) {
  try {
    await sbDelete('demandes', `id=eq.${payload.id}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    let result;

    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const action = params.action;

      switch (action) {
        case 'getClub':
          result = await getClub(params.email);
          break;
        case 'getCatalogue':
          result = await getCatalogue(params.clubId, params.clubNom);
          break;
        case 'getOrders':
          result = await getOrders(params.clubId);
          break;
        case 'getAllOrders':
          result = await getAllOrders();
          break;
        case 'getOrderDetail':
          result = await getOrderDetail(params.orderId);
          break;
        case 'getDemandes':
          result = await getDemandes(params.clubId);
          break;
        // Admin GET
        case 'adminGetClubs':
          result = await adminGetClubs();
          break;
        case 'adminGetProduits':
          result = await adminGetProduits();
          break;
        case 'adminGetSuivi':
          result = await adminGetSuivi(params.commandeId);
          break;
        case 'adminGetAllDemandes':
          result = await adminGetAllDemandes();
          break;
        default:
          result = { error: 'Action inconnue' };
      }
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body);
      const action = payload.action;

      switch (action) {
        case 'createOrder':
          result = await createOrder(payload);
          break;
        case 'createLignes':
          result = await createLignes(payload);
          break;
        case 'createDemande':
          result = await createDemande(payload);
          break;
        // Admin POST
        case 'adminCreateClub':
          result = await adminCreateClub(payload);
          break;
        case 'adminUpdateClub':
          result = await adminUpdateClub(payload);
          break;
        case 'adminDeleteClub':
          result = await adminDeleteClub(payload);
          break;
        case 'adminCreateProduit':
          result = await adminCreateProduit(payload);
          break;
        case 'adminUpdateProduit':
          result = await adminUpdateProduit(payload);
          break;
        case 'adminDeleteProduit':
          result = await adminDeleteProduit(payload);
          break;
        case 'adminUpdateOrder':
          result = await adminUpdateOrder(payload);
          break;
        case 'adminDeleteOrder':
          result = await adminDeleteOrder(payload);
          break;
        case 'adminCreateSuivi':
          result = await adminCreateSuivi(payload);
          break;
        case 'adminUpdateSuivi':
          result = await adminUpdateSuivi(payload);
          break;
        case 'adminDeleteSuivi':
          result = await adminDeleteSuivi(payload);
          break;
        case 'adminUpdateDemande':
          result = await adminUpdateDemande(payload);
          break;
        case 'adminDeleteDemande':
          result = await adminDeleteDemande(payload);
          break;
        default:
          result = { error: 'Action POST inconnue' };
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
