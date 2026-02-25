// ============================================================
// BOTH EQUIPMNT — Netlify Function Airtable
// Remplace Google Apps Script pour le Vestiaire
// ============================================================

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_API = 'https://api.airtable.com/v0';

// IDs des tables
const TABLE_CLUBS = 'tblsBiicwKqdFe7h5';
const TABLE_PRODUITS = 'tbl8ri4tUfg1TH659';
const TABLE_COMMANDES = 'tbloz7JkktaBoHWie';
const TABLE_LIGNES = 'tblWuqefKcUPd4I22';
const TABLE_DEMANDES = process.env.AIRTABLE_TABLE_DEMANDES || '';

// ============================================================
// HELPER: Requête Airtable
// ============================================================
async function airtableRequest(table, options = {}) {
  const url = `${AIRTABLE_API}/${BASE_ID}/${table}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Airtable error: ${error}`);
  }

  return response.json();
}

// ============================================================
// HELPER: Batch create records (max 10 per request, Airtable limit)
// ============================================================
async function airtableBatchCreate(table, records) {
  const results = [];
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const data = await airtableRequest(table, {
      method: 'POST',
      body: JSON.stringify({ records: batch })
    });
    results.push(...(data.records || []));
  }
  return results;
}

// ============================================================
// HELPER: Fetch all records with pagination
// ============================================================
async function airtableRequestAll(table, filterFormula) {
  let allRecords = [];
  let offset = null;
  do {
    let url = `${AIRTABLE_API}/${BASE_ID}/${table}`;
    const qs = [];
    if (filterFormula) qs.push(`filterByFormula=${encodeURIComponent(filterFormula)}`);
    if (offset) qs.push(`offset=${offset}`);
    if (qs.length) url += '?' + qs.join('&');
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Airtable error: ${error}`);
    }
    const data = await response.json();
    allRecords = allRecords.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  return allRecords;
}

// ============================================================
// GET CLUB (login)
// ============================================================
async function getClub(email) {
  try {
    console.log('getClub called with email:', email);
    const url = `${AIRTABLE_API}/${BASE_ID}/${TABLE_CLUBS}`;
    console.log('Fetching from:', url);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Airtable error:', error);
      return { error: error };
    }

    const data = await response.json();
    console.log('Airtable response:', JSON.stringify(data, null, 2));
    const records = data.records || [];
    console.log('Number of records:', records.length);

    // Filtrer manuellement (case insensitive, multi-emails)
    const club = records.find(r => {
      // Champ single email
      const singleEmail = r.fields['email'] || '';
      if (singleEmail && singleEmail.toLowerCase() === email.toLowerCase()) return true;
      // Champ multi emails (séparés par virgule)
      const multiEmails = r.fields['Emails'] || '';
      if (multiEmails) {
        const list = multiEmails.split(',').map(e => e.trim().toLowerCase());
        if (list.includes(email.toLowerCase())) return true;
      }
      return false;
    });

    console.log('Found club:', club);

    if (!club) {
      return { club: null };
    }

    // Enregistrer la connexion (non bloquant)
    fetch(`${AIRTABLE_API}/${BASE_ID}/${TABLE_CLUBS}/${club.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          'Dernière connexion': new Date().toISOString(),
          'Dernier email connexion': email
        }
      })
    }).catch(err => console.error('Erreur maj connexion:', err));

    return {
      club: {
        id: club.id,
        nom: club.fields['Nom'] || '',
        email: club.fields['email'] || '',
        logoClub: club.fields['Logo Club URL'] || '',
        minCommande: parseFloat(club.fields['Minimum Commande']) || 0,
        activeMin: club.fields['Active Minimum'] || false,
        fraisLivraison: parseFloat(club.fields['Frais Livraison']) || 0,
        admin: club.fields['Admin'] || false
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
  const commandesRecords = await airtableRequestAll(TABLE_COMMANDES);
  const clubCommandeIds = commandesRecords
    .filter(r => {
      const clubLink = r.fields['Club'];
      return clubLink && clubLink[0] === clubId;
    })
    .map(r => r.id);

  if (!clubCommandeIds.length) return {};

  const lignesRecords = await airtableRequestAll(TABLE_LIGNES);
  const dejaCommande = {};
  lignesRecords.forEach(r => {
    const cmdLink = r.fields['Commande'];
    if (cmdLink && clubCommandeIds.includes(cmdLink[0])) {
      const prodLink = r.fields['Produit'];
      const prodId = prodLink ? prodLink[0] : null;
      if (prodId) {
        dejaCommande[prodId] = (dejaCommande[prodId] || 0) + (r.fields['Quantité'] || 0);
      }
    }
  });

  return dejaCommande;
}

// ============================================================
// GET CATALOGUE
// ============================================================
async function getCatalogue(clubId, clubNom) {
  try {
    const [data, dejaCommande] = await Promise.all([
      airtableRequest(TABLE_PRODUITS, { method: 'GET' }),
      getDejaCommande(clubId)
    ]);

    const products = (data.records || [])
      .filter(r => r.fields['Visible Vestiaire'] && !r.fields['Expiré'])
      .filter(r => {
        const club = r.fields['Club'];
        return club && club === clubNom;
      })
      .map(r => ({
        id: r.id,
        nom: r.fields['Nom'] || '',
        image: r.fields['Image URL'] || '',
        prix: parseFloat(r.fields['Prix Vente Club']) || 0,
        tailles: r.fields['Tailles disponibles'] || [],
        personnalisation: r.fields['Personnalisation'] || 'Aucune',
        categorie: r.fields['Type'] || '',
        description: r.fields['Description'] || '',
        minQuantite: parseInt(r.fields['Min Quantité']) || 0,
        maxQuantite: parseInt(r.fields['Max Quantité']) || 0,
        groupeStock: r.fields['Groupe Stock'] || '',
        stockGroupe: parseInt(r.fields['Stock Groupe']) || 0,
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
    const data = await airtableRequest(TABLE_COMMANDES, {
      method: 'GET'
    });

    const orders = (data.records || [])
      .filter(r => {
        const clubLink = r.fields['Club'];
        return clubLink && clubLink[0] === clubId;
      })
      .map(r => ({
        ref: r.fields['Référence'] || '',
        date: r.fields['Date'] ? new Date(r.fields['Date']).toLocaleDateString('fr-FR') : '',
        nbArticles: r.fields['Nb Articles'] || 0,
        total: r.fields['Total'] || 0,
        statut: r.fields['Statut'] || '🟡 EN ATTENTE DE PAIEMENT'
      }));

    return { orders };
  } catch (error) {
    console.error('getOrders error:', error);
    return { error: error.message };
  }
}

// ============================================================
// GET ALL ORDERS (admin — toutes les commandes de tous les clubs)
// ============================================================
async function getAllOrders() {
  try {
    const [commandesRecords, clubsData] = await Promise.all([
      airtableRequestAll(TABLE_COMMANDES),
      airtableRequest(TABLE_CLUBS, { method: 'GET' })
    ]);

    // Map club IDs to names/emails
    const clubsMap = {};
    (clubsData.records || []).forEach(r => {
      clubsMap[r.id] = {
        nom: r.fields['Nom'] || '',
        email: r.fields['email'] || '',
        fraisLivraison: parseFloat(r.fields['Frais Livraison']) || 0
      };
    });

    const orders = commandesRecords.map(r => {
      const clubLink = r.fields['Club'];
      const clubId = clubLink ? clubLink[0] : null;
      const club = clubId ? clubsMap[clubId] : { nom: '—', email: '', fraisLivraison: 0 };
      return {
        id: r.id,
        ref: r.fields['Référence'] || '',
        date: r.fields['Date'] ? new Date(r.fields['Date']).toLocaleDateString('fr-FR') : '',
        nbArticles: r.fields['Nb Articles'] || 0,
        total: r.fields['Total'] || 0,
        statut: r.fields['Statut'] || '🟡 EN ATTENTE DE PAIEMENT',
        clubNom: club.nom,
        clubEmail: club.email,
        fraisLivraison: club.fraisLivraison
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
    const commande = await airtableRequest(`${TABLE_COMMANDES}/${orderId}`);
    if (!commande || !commande.fields) return { error: 'Commande introuvable' };

    // Récupérer club info et lignes en parallèle
    const clubLink = commande.fields['Club'];
    const clubId = clubLink ? clubLink[0] : null;
    const lignesIds = commande.fields['Lignes'];
    const ref = commande.fields['Référence'] || '';

    const [clubInfo, lignes] = await Promise.all([
      // Club info
      (async () => {
        if (!clubId) return { nom: '—', email: '' };
        try {
          const clubRec = await airtableRequest(`${TABLE_CLUBS}/${clubId}`);
          return { nom: clubRec.fields['Nom'] || '', email: clubRec.fields['email'] || '' };
        } catch (e) { return { nom: '—', email: '' }; }
      })(),
      // Lignes de commande
      (async () => {
        if (Array.isArray(lignesIds) && lignesIds.length) {
          // Reverse link disponible — récupérer chaque ligne par ID (rapide)
          return (await Promise.all(lignesIds.map(id =>
            airtableRequest(`${TABLE_LIGNES}/${id}`).catch(() => null)
          ))).filter(Boolean);
        } else if (ref) {
          // Filtrer par Référence de la commande (display value du linked record)
          return await airtableRequestAll(TABLE_LIGNES, `FIND("${ref}", {Commande}&"")`);
        } else {
          // Dernier recours — tout charger et filtrer
          const all = await airtableRequestAll(TABLE_LIGNES);
          return all.filter(r => {
            const cmdLink = r.fields['Commande'];
            return cmdLink && cmdLink[0] === orderId;
          });
        }
      })()
    ]);

    // Récupérer les produits référencés (en parallèle)
    const productIds = [...new Set(lignes.map(l => l.fields['Produit'] ? l.fields['Produit'][0] : null).filter(Boolean))];
    const produitsMap = {};
    await Promise.all(productIds.map(async pid => {
      try {
        const prod = await airtableRequest(`${TABLE_PRODUITS}/${pid}`);
        produitsMap[pid] = { nom: prod.fields['Nom'] || '', prix: parseFloat(prod.fields['Prix Vente Club']) || 0 };
      } catch (e) { produitsMap[pid] = { nom: 'Produit inconnu', prix: 0 }; }
    }));

    const lignesDetail = lignes.map(l => {
      const prodId = l.fields['Produit'] ? l.fields['Produit'][0] : null;
      const prod = prodId ? produitsMap[prodId] : { nom: '—', prix: 0 };
      return {
        produit: prod.nom,
        prixUnitaire: prod.prix,
        taille: l.fields['Taille'] || '',
        quantite: l.fields['Quantité'] || 0,
        nomPerso: l.fields['Nom Personnalisation'] || '',
        numPerso: l.fields['Numéro Personnalisation'] || ''
      };
    });

    return {
      order: {
        id: commande.id,
        ref: commande.fields['Référence'] || '',
        date: commande.fields['Date'] ? new Date(commande.fields['Date']).toLocaleDateString('fr-FR') : '',
        total: commande.fields['Total'] || 0,
        nbArticles: commande.fields['Nb Articles'] || 0,
        statut: commande.fields['Statut'] || '',
        fraisLivraison: parseFloat(commande.fields['Frais Livraison']) || 0,
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
    // Référence générée côté client (idempotence) ou serveur (fallback)
    const ref = payload.orderRef || `CMD-${(payload.clubNom || 'CLUB').toUpperCase().replace(/[^A-Z0-9]/g, '')}-${Date.now().toString().slice(-6)}`;

    // Vérifier si cette commande existe déjà (protection doublon)
    const existing = await airtableRequestAll(TABLE_COMMANDES, `{Référence}="${ref}"`);
    if (existing.length > 0) {
      return { success: true, orderRef: ref, duplicate: true };
    }

    const totalArticles = payload.lignes.reduce((sum, l) => sum + l.quantite, 0);

    // Créer la commande
    const commandeData = await airtableRequest(TABLE_COMMANDES, {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          'Référence': ref,
          'Club': [payload.clubId],
          'Statut': '🟡 EN ATTENTE DE PAIEMENT',
          'Vu': '❌',
          'Total': payload.total,
          'Nb Articles': totalArticles,
          'Frais Livraison': payload.fraisLivraison || 0
        }
      })
    });

    const commandeId = commandeData.id;

    // Créer les lignes en batch (10 par requête — limite Airtable)
    const lignesRecords = payload.lignes.map(ligne => ({
      fields: {
        'Commande': [commandeId],
        'Produit': [ligne.productId],
        'Taille': ligne.taille,
        'Quantité': ligne.quantite,
        'Nom Personnalisation': ligne.nomPerso || '',
        'Numéro Personnalisation': ligne.numPerso || ''
      }
    }));

    await airtableBatchCreate(TABLE_LIGNES, lignesRecords);

    return {
      success: true,
      orderRef: ref
    };
  } catch (error) {
    console.error('createOrder error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================
// GET DEMANDES
// ============================================================
async function getDemandes(clubId) {
  try {
    if (!TABLE_DEMANDES) return { demandes: [], error: 'Table Demandes non configurée' };
    
    const data = await airtableRequest(TABLE_DEMANDES, {
      method: 'GET'
    });

    const demandes = (data.records || [])
      .filter(r => {
        const clubLink = r.fields['Club'];
        return clubLink && clubLink[0] === clubId;
      })
      .map(r => ({
        id: r.id,
        objet: r.fields['Objet'] || '',
        message: r.fields['Message'] || '',
        date: r.fields['Date'] ? new Date(r.fields['Date']).toLocaleDateString('fr-FR') : '',
        statut: r.fields['Statut'] || 'Nouvelle',
        reponse: r.fields['Réponse'] || ''
      }))
      .reverse();

    return { demandes };
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
    if (!TABLE_DEMANDES) return { success: false, error: 'Table Demandes non configurée' };

    await airtableRequest(TABLE_DEMANDES, {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          'Club': [payload.clubId],
          'Objet': payload.objet || '',
          'Message': payload.message || '',
          'Statut': 'Nouvelle'
        }
      })
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
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  // Handle OPTIONS (preflight)
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    let result;

    // GET requests
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

    // POST requests
    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body);
      const action = payload.action;

      switch (action) {
        case 'createOrder':
          result = await createOrder(payload);
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
