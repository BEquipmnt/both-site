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
