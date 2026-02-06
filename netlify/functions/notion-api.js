// netlify/functions/notion-api.js
// Proxy entre le site BOTH EQUIPMNT et l'API Notion

const NOTION_KEY = process.env.NOTION_KEY;
const DB_ACTUALITES = process.env.NOTION_DB_ACTUALITES;
const DB_PORTFOLIO = process.env.NOTION_DB_PORTFOLIO;

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function notionFetch(endpoint, body = null) {
  const opts = {
    method: body ? 'POST' : 'GET',
    headers: {
      'Authorization': `Bearer ${NOTION_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${NOTION_API}${endpoint}`, opts).then(r => r.json());
}

function getProp(page, name, type) {
  const prop = page.properties[name];
  if (!prop) return null;
  switch (type) {
    case 'title':
      return prop.title?.map(t => t.plain_text).join('') || '';
    case 'rich_text':
    case 'text':
      return prop.rich_text?.map(t => t.plain_text).join('') || '';
    case 'date':
      return prop.date?.start || '';
    case 'checkbox':
      return prop.checkbox || false;
    case 'url':
      return prop.url || '';
    case 'number':
      return prop.number || 0;
    default:
      return null;
  }
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

async function getNews(id) {
  if (id) {
    const page = await notionFetch(`/pages/${id}`);
    if (page.object === 'error') return { news: null };
    return {
      news: {
        id: page.id,
        titre: getProp(page, 'Titre', 'title'),
        date: formatDate(getProp(page, 'Date', 'date')),
        texte_court: getProp(page, 'Texte_Court', 'rich_text'),
        image: getProp(page, 'Image', 'url'),
        lien_externe: getProp(page, 'Lien_Externe', 'url'),
        images: [getProp(page, 'Image', 'url')].filter(Boolean),
      }
    };
  }
  const data = await notionFetch(`/databases/${DB_ACTUALITES}/query`, {
    filter: { property: 'Publié', checkbox: { equals: true } },
    sorts: [{ property: 'Date', direction: 'descending' }]
  });
  const news = (data.results || []).map((page, index) => ({
    id: page.id,
    titre: getProp(page, 'Titre', 'title'),
    date: formatDate(getProp(page, 'Date', 'date')),
    texte_court: getProp(page, 'Texte_Court', 'rich_text'),
    image: getProp(page, 'Image', 'url'),
    lien_externe: getProp(page, 'Lien_Externe', 'url'),
  }));
  return { news };
}

async function getPortfolio(id, all) {
  if (id) {
    const page = await notionFetch(`/pages/${id}`);
    if (page.object === 'error') return { projects: null };
    const galerieStr = getProp(page, 'Images_Galerie', 'rich_text');
    const galerie = galerieStr ? galerieStr.split(',').map(u => u.trim()).filter(Boolean) : [];
    return {
      projects: {
        id: page.id,
        nom: getProp(page, 'Nom', 'title'),
        club: getProp(page, 'Club', 'rich_text'),
        annee: getProp(page, 'Année', 'rich_text'),
        image: getProp(page, 'Image_Cover', 'url'),
        description: getProp(page, 'Description', 'rich_text'),
        galerie: galerie,
      }
    };
  }
  const filter = all === 'true'
    ? undefined
    : { property: 'Mis_en_avant', checkbox: { equals: true } };
  const body = { sorts: [{ property: 'Année', direction: 'descending' }] };
  if (filter) body.filter = filter;
  const data = await notionFetch(`/databases/${DB_PORTFOLIO}/query`, body);
  const projects = (data.results || []).map(page => ({
    id: page.id,
    nom: getProp(page, 'Nom', 'title'),
    club: getProp(page, 'Club', 'rich_text'),
    annee: getProp(page, 'Année', 'rich_text'),
    image: getProp(page, 'Image_Cover', 'url'),
    description: getProp(page, 'Description', 'rich_text'),
    mis_en_avant: getProp(page, 'Mis_en_avant', 'checkbox'),
  }));
  return { projects };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  const params = event.queryStringParameters || {};
  const action = params.action;
  try {
    let result;
    switch (action) {
      case 'getNews':
        result = await getNews(params.id);
        break;
      case 'getPortfolio':
        result = await getPortfolio(params.id, params.all);
        break;
      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Action inconnue: ' + action }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    console.error('Notion API Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur serveur', details: err.message }) };
  }
};
