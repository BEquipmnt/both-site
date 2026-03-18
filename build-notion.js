#!/usr/bin/env node
// build-notion.js
// Script de pré-génération : appelle l'API Notion et génère des fichiers JSON statiques
// Exécuté au build Netlify (ou via bouton "Régénérer" dans l'admin)

const fs = require('fs');
const path = require('path');

const NOTION_KEY = process.env.NOTION_KEY;
const DB_ACTUALITES = process.env.NOTION_DB_ACTUALITES;
const DB_PORTFOLIO = process.env.NOTION_DB_PORTFOLIO;
const DB_PARTNERS = process.env.NOTION_DB_PARTNERS;
const PAGE_VISION = process.env.NOTION_PAGE_VISION;

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const OUT_DIR = path.join(__dirname, '_data');

if (!NOTION_KEY) {
  console.error('NOTION_KEY manquant — skip build Notion');
  process.exit(0);
}

// ============================================================
// HELPERS (même logique que notion-api.js)
// ============================================================

function notionFetch(endpoint, body = null) {
  const url = `${NOTION_API}${endpoint}`;
  const opts = {
    method: body ? 'POST' : 'GET',
    headers: {
      'Authorization': `Bearer ${NOTION_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts).then(r => r.json());
}

function getProp(page, name, type) {
  const prop = page.properties[name];
  if (!prop) return null;
  switch (type) {
    case 'title': return prop.title?.map(t => t.plain_text).join('') || '';
    case 'rich_text': case 'text': return prop.rich_text?.map(t => t.plain_text).join('') || '';
    case 'date': return prop.date?.start || '';
    case 'checkbox': return prop.checkbox || false;
    case 'url': return prop.url || '';
    case 'number': return prop.number || 0;
    default: return null;
  }
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function richTextToHtml(richText) {
  if (!richText || !richText.length) return '';
  return richText.map(t => {
    let text = t.plain_text;
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (t.annotations) {
      if (t.annotations.bold) text = `<strong>${text}</strong>`;
      if (t.annotations.italic) text = `<em>${text}</em>`;
      if (t.annotations.underline) text = `<u>${text}</u>`;
      if (t.annotations.strikethrough) text = `<s>${text}</s>`;
      if (t.annotations.code) text = `<code>${text}</code>`;
      const color = t.annotations.color;
      if (color && color !== 'default') text = `<span class="notion-${color}">${text}</span>`;
    }
    if (t.href) text = `<a href="${t.href}" target="_blank">${text}</a>`;
    return text;
  }).join('');
}

function mapBlock(block) {
  const type = block.type;
  switch (type) {
    case 'paragraph': return { type: 'paragraph', text: richTextToHtml(block.paragraph.rich_text) };
    case 'heading_1': return { type: 'heading_1', text: richTextToHtml(block.heading_1.rich_text) };
    case 'heading_2': return { type: 'heading_2', text: richTextToHtml(block.heading_2.rich_text) };
    case 'heading_3': return { type: 'heading_3', text: richTextToHtml(block.heading_3.rich_text) };
    case 'image': {
      const url = block.image.type === 'external' ? block.image.external.url : (block.image.file ? block.image.file.url : '');
      const caption = block.image.caption ? block.image.caption.map(t => t.plain_text).join('') : '';
      return { type: 'image', url, caption };
    }
    case 'bulleted_list_item': return { type: 'bulleted_list_item', text: richTextToHtml(block.bulleted_list_item.rich_text) };
    case 'numbered_list_item': return { type: 'numbered_list_item', text: richTextToHtml(block.numbered_list_item.rich_text) };
    case 'quote': return { type: 'quote', text: richTextToHtml(block.quote.rich_text) };
    case 'divider': return { type: 'divider' };
    case 'column_list':
      if (!block.columns) return null;
      return { type: 'column_list', columns: block.columns.map(col => (col.children || []).map(child => mapBlock(child)).filter(Boolean)) };
    case 'video': {
      const videoUrl = block.video.type === 'external' ? block.video.external.url : '';
      return { type: 'video', url: videoUrl };
    }
    case 'callout': {
      const icon = block.callout.icon ? (block.callout.icon.emoji || '') : '';
      return { type: 'callout', icon, text: richTextToHtml(block.callout.rich_text) };
    }
    default: return null;
  }
}

async function fetchBlocksWithColumns(pageId) {
  let allBlocks = [];
  let cursor = undefined;
  do {
    const endpoint = `/blocks/${pageId}/children?page_size=100${cursor ? '&start_cursor=' + cursor : ''}`;
    const data = await notionFetch(endpoint);
    allBlocks = allBlocks.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  for (let i = 0; i < allBlocks.length; i++) {
    if (allBlocks[i].type === 'column_list') {
      const colListData = await notionFetch(`/blocks/${allBlocks[i].id}/children?page_size=100`);
      const columns = colListData.results || [];
      for (let j = 0; j < columns.length; j++) {
        const colChildren = await notionFetch(`/blocks/${columns[j].id}/children?page_size=100`);
        columns[j].children = colChildren.results || [];
      }
      allBlocks[i].columns = columns;
    }
  }
  return allBlocks.map(b => mapBlock(b)).filter(Boolean);
}

// ============================================================
// FETCHERS
// ============================================================

async function buildNews() {
  if (!DB_ACTUALITES) { console.log('  skip news (pas de DB_ACTUALITES)'); return; }
  console.log('  Actualités...');
  const data = await notionFetch(`/databases/${DB_ACTUALITES}/query`, {
    filter: { property: 'Publié', checkbox: { equals: true } },
    sorts: [{ property: 'Date', direction: 'descending' }]
  });
  const news = (data.results || []).map(page => ({
    id: page.id,
    titre: getProp(page, 'Titre', 'title'),
    date: formatDate(getProp(page, 'Date', 'date')),
    texte_court: getProp(page, 'Texte_Court', 'rich_text'),
    image: getProp(page, 'Image', 'url'),
    lien_externe: getProp(page, 'Lien_Externe', 'url'),
  }));
  writeJSON('news.json', { news });

  // Détail de chaque actu (pour actualite-detail)
  for (const n of news) {
    const page = await notionFetch(`/pages/${n.id}`);
    writeJSON(`news-${n.id}.json`, {
      news: {
        id: n.id,
        titre: getProp(page, 'Titre', 'title'),
        date: formatDate(getProp(page, 'Date', 'date')),
        texte_court: getProp(page, 'Texte_Court', 'rich_text'),
        image: getProp(page, 'Image', 'url'),
        lien_externe: getProp(page, 'Lien_Externe', 'url'),
        images: [getProp(page, 'Image', 'url')].filter(Boolean),
      }
    });
  }
  console.log(`  → ${news.length} actualités`);
}

async function buildPortfolio() {
  if (!DB_PORTFOLIO) { console.log('  skip portfolio (pas de DB_PORTFOLIO)'); return; }
  console.log('  Portfolio...');
  const data = await notionFetch(`/databases/${DB_PORTFOLIO}/query`, {
    sorts: [{ property: 'Année', direction: 'descending' }]
  });
  const projects = (data.results || []).map(page => {
    const galerieStr = getProp(page, 'Images_Galerie', 'rich_text');
    const galerie = galerieStr ? galerieStr.split(',').map(u => u.trim()).filter(Boolean) : [];
    return {
      id: page.id,
      nom: getProp(page, 'Nom', 'title'),
      club: getProp(page, 'Club', 'rich_text'),
      annee: getProp(page, 'Année', 'rich_text'),
      image: getProp(page, 'Image_Cover', 'url'),
      description: getProp(page, 'Description', 'rich_text'),
      mis_en_avant: getProp(page, 'Mis_en_avant', 'checkbox'),
      galerie,
    };
  });
  writeJSON('portfolio.json', { projects });
  // Version "featured only" pour index.html
  writeJSON('portfolio-featured.json', { projects: projects.filter(p => p.mis_en_avant) });

  // Détail de chaque projet (blocks Notion)
  for (const p of projects) {
    console.log(`    → blocks: ${p.nom}`);
    const blocks = await fetchBlocksWithColumns(p.id);
    writeJSON(`project-${p.id}.json`, {
      project: { ...p, blocks }
    });
  }
  console.log(`  → ${projects.length} projets`);
}

async function buildVision() {
  if (!PAGE_VISION) { console.log('  skip vision (pas de PAGE_VISION)'); return; }
  console.log('  Vision...');
  const page = await notionFetch(`/pages/${PAGE_VISION}`);
  if (page.object === 'error') { console.log('  skip vision (erreur Notion)'); return; }

  const blocks = await fetchBlocksWithColumns(PAGE_VISION);
  const titre = getProp(page, 'Titre', 'title') || getProp(page, 'Name', 'title') || getProp(page, 'title', 'title') || '';

  writeJSON('vision.json', { vision: { titre, blocks } });
  console.log(`  → ${blocks.length} blocks`);
}

async function buildPartners() {
  if (!DB_PARTNERS) { console.log('  skip partners (pas de DB_PARTNERS)'); return; }
  console.log('  Partenaires...');
  const data = await notionFetch(`/databases/${DB_PARTNERS}/query`, {});
  const partners = (data.results || []).map(page => ({
    nom: getProp(page, 'Nom', 'title'),
    logo: getProp(page, 'Logo', 'url'),
  }));
  writeJSON('partners.json', { partners });
  console.log(`  → ${partners.length} partenaires`);
}

// ============================================================
// UTILS
// ============================================================

function writeJSON(filename, data) {
  fs.writeFileSync(path.join(OUT_DIR, filename), JSON.stringify(data));
}

async function main() {
  console.log('🔨 Build Notion → _data/');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  await buildNews();
  await buildPortfolio();
  await buildVision();
  await buildPartners();

  console.log('✅ Build Notion terminé');
}

main().catch(err => {
  console.error('❌ Build Notion échoué:', err.message);
  process.exit(1);
});
