// netlify/functions/notion-api.js
// Proxy entre le site BOTH EQUIPMNT et l'API Notion
// Gère : Actualités + Portfolio + Partenaires

const NOTION_KEY = process.env.NOTION_KEY;
const DB_ACTUALITES = process.env.NOTION_DB_ACTUALITES;
const DB_PORTFOLIO = process.env.NOTION_DB_PORTFOLIO;
const DB_PARTNERS = process.env.NOTION_DB_PARTNERS;

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

// ============================================================
// GET PROJECT BLOCKS (contenu de page Notion pour case studies)
// ============================================================
async function getProjectBlocks(pageId) {
  // 1. Récupérer les propriétés de la page
  const page = await notionFetch(`/pages/${pageId}`);
  if (page.object === 'error') return { project: null };

  // 2. Récupérer les blocs enfants (contenu de la page)
  let allBlocks = [];
  let cursor = undefined;
  do {
    const endpoint = `/blocks/${pageId}/children?page_size=100${cursor ? '&start_cursor=' + cursor : ''}`;
    const data = await notionFetch(endpoint);
    allBlocks = allBlocks.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  // 3. Pour les column_list, récupérer les enfants (columns)
  for (let i = 0; i < allBlocks.length; i++) {
    if (allBlocks[i].type === 'column_list') {
      const colListData = await notionFetch(`/blocks/${allBlocks[i].id}/children?page_size=100`);
      const columns = colListData.results || [];
      // Pour chaque colonne, récupérer ses enfants
      for (let j = 0; j < columns.length; j++) {
        const colChildren = await notionFetch(`/blocks/${columns[j].id}/children?page_size=100`);
        columns[j].children = colChildren.results || [];
      }
      allBlocks[i].columns = columns;
    }
  }

  // 4. Mapper les blocs en format simplifié
  const blocks = allBlocks.map(block => mapBlock(block)).filter(Boolean);

  const galerieStr = getProp(page, 'Images_Galerie', 'rich_text');
  const galerie = galerieStr ? galerieStr.split(',').map(u => u.trim()).filter(Boolean) : [];

  return {
    project: {
      id: page.id,
      nom: getProp(page, 'Nom', 'title'),
      club: getProp(page, 'Club', 'rich_text'),
      annee: getProp(page, 'Année', 'rich_text'),
      image: getProp(page, 'Image_Cover', 'url'),
      description: getProp(page, 'Description', 'rich_text'),
      galerie: galerie,
      blocks: blocks
    }
  };
}

function mapBlock(block) {
  const type = block.type;
  switch (type) {
    case 'paragraph':
      return { type: 'paragraph', text: richTextToHtml(block.paragraph.rich_text) };
    case 'heading_1':
      return { type: 'heading_1', text: richTextToHtml(block.heading_1.rich_text) };
    case 'heading_2':
      return { type: 'heading_2', text: richTextToHtml(block.heading_2.rich_text) };
    case 'heading_3':
      return { type: 'heading_3', text: richTextToHtml(block.heading_3.rich_text) };
    case 'image':
      const url = block.image.type === 'external' ? block.image.external.url : (block.image.file ? block.image.file.url : '');
      const caption = block.image.caption ? block.image.caption.map(t => t.plain_text).join('') : '';
      return { type: 'image', url, caption };
    case 'bulleted_list_item':
      return { type: 'bulleted_list_item', text: richTextToHtml(block.bulleted_list_item.rich_text) };
    case 'numbered_list_item':
      return { type: 'numbered_list_item', text: richTextToHtml(block.numbered_list_item.rich_text) };
    case 'quote':
      return { type: 'quote', text: richTextToHtml(block.quote.rich_text) };
    case 'divider':
      return { type: 'divider' };
    case 'column_list':
      if (!block.columns) return null;
      const cols = block.columns.map(col => {
        const children = (col.children || []).map(child => mapBlock(child)).filter(Boolean);
        return children;
      });
      return { type: 'column_list', columns: cols };
    case 'video':
      const videoUrl = block.video.type === 'external' ? block.video.external.url : '';
      return { type: 'video', url: videoUrl };
    case 'callout':
      const icon = block.callout.icon ? (block.callout.icon.emoji || '') : '';
      return { type: 'callout', icon, text: richTextToHtml(block.callout.rich_text) };
    default:
      return null;
  }
}

function richTextToHtml(richText) {
  if (!richText || !richText.length) return '';
  return richText.map(t => {
    let text = t.plain_text;
    // Escape HTML
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (t.annotations) {
      if (t.annotations.bold) text = `<strong>${text}</strong>`;
      if (t.annotations.italic) text = `<em>${text}</em>`;
      if (t.annotations.underline) text = `<u>${text}</u>`;
      if (t.annotations.strikethrough) text = `<s>${text}</s>`;
      if (t.annotations.code) text = `<code>${text}</code>`;
    }
    if (t.href) text = `<a href="${t.href}" target="_blank">${text}</a>`;
    return text;
  }).join('');
}

async function getPartners() {
  const data = await notionFetch(`/databases/${DB_PARTNERS}/query`, {});
  const partners = (data.results || []).map(page => ({
    nom: getProp(page, 'Nom', 'title'),
    logo: getProp(page, 'Logo', 'url'),
  }));
  return { partners };
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
      case 'getProjectBlocks':
        result = await getProjectBlocks(params.id);
        break;
      case 'getPartners':
        result = await getPartners();
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
