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

    return {
      club: {
        id: club.id,
        nom: club.fields['Nom'] || '',
        email: club.fields['email'] || '',
        logoClub: club.fields['Logo Club URL'] || '',
        minCommande: parseFloat(club.fields['Minimum Commande']) || 0,
        activeMin: club.fields['Active Minimum'] || false
      }
    };
  } catch (error) {
    console.error('getClub error:', error);
    return { error: error.message };
  }
}

// ============================================================
// GET CATALOGUE
// ============================================================
async function getCatalogue(clubId, clubNom) {
  try {
    const data = await airtableRequest(TABLE_PRODUITS, {
      method: 'GET'
    });

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
        stockGroupe: parseInt(r.fields['Stock Groupe']) || 0
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
// CREATE ORDER
// ============================================================
async function createOrder(payload) {
  try {
    const clubName = (payload.clubNom || 'CLUB').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const shortId = Date.now().toString().slice(-6);
    const ref = `CMD-${clubName}-${shortId}`;
    const now = new Date().toISOString();
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
          'Nb Articles': totalArticles
        }
      })
    });

    const commandeId = commandeData.id;

    // Créer les lignes de commande
    const lignesPromises = payload.lignes.map(ligne => {
      return airtableRequest(TABLE_LIGNES, {
        method: 'POST',
        body: JSON.stringify({
          fields: {
            'Commande': [commandeId],
            'Produit': [ligne.productId],
            'Taille': ligne.taille,
            'Quantité': ligne.quantite,
            'Nom Personnalisation': ligne.nomPerso || '',
            'Numéro Personnalisation': ligne.numPerso || ''
          }
        })
      });
    });

    await Promise.all(lignesPromises);

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
      .sort((a, b) => {
        // Plus récentes en premier
        const da = r => r.fields && r.fields['Date'] ? new Date(r.fields['Date']) : new Date(0);
        return 0; // Airtable renvoie déjà dans l'ordre de création
      })
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
