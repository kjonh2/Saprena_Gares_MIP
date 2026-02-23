const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Install better-sqlite3 if needed
try {
  require('better-sqlite3');
} catch (e) {
  console.log('Installing better-sqlite3...');
  execSync('npm install better-sqlite3 --save', { stdio: 'inherit' });
}

const Database = require('better-sqlite3');
const db = new Database('./gares.db');

// ── Schema ──────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS gares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prestation TEXT NOT NULL,
    gare TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scan_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gare_id INTEGER NOT NULL,
    label TEXT,
    FOREIGN KEY(gare_id) REFERENCES gares(id)
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gare_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'repor',
    FOREIGN KEY(gare_id) REFERENCES gares(id)
  );
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gare_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(gare_id) REFERENCES gares(id)
  );
`);

// Seed data
const DATA = {
  'MIP':          ['Pulse 1','Pulse 2','PAT'],
  'Kickboard':    ['Polaris 3','PAT'],
  'Avis 05/09':   ['G44','Pulse 1','Pulse 2','Polaris 3 Avis 09','Polaris 3 Avis 05','Polaris 2 table d\'arrivée'],
  'ESAT':         ['ESAT','Daher'],
  'Plinthes':     ['Pulse 1','Pulse 2','Polaris 3','Polaris 1 5éme ligne','Salsa','Salsa','ISS'],
  'Obturateur':   ['B','A','5éme','6éme','G33'],
  'FOD':          ['G33','G44','G73','Avion','Pulse 1','Pulse 2'],
  'Rail CLS':     ['Polaris 4','G33'],
};

const existing = db.prepare('SELECT COUNT(*) as c FROM gares').get();
if (existing.c === 0) {
  const insertGare = db.prepare('INSERT INTO gares (prestation, gare) VALUES (?,?)');
  const insertScan = db.prepare('INSERT INTO scan_points (gare_id, label) VALUES (?,?)');
  for (const [prest, gares] of Object.entries(DATA)) {
    for (const gare of gares) {
      const info = insertGare.run(prest, gare);
      insertScan.run(info.lastInsertRowid, 'Ponto de scan ' + gare);
    }
  }
}

// Photos dir
const PHOTOS_DIR = path.join(__dirname, 'photos');
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR);

// ── Helper ───────────────────────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function parseMultipart(buffer, boundary) {
  const parts = [];
  const sep = Buffer.from('--' + boundary);
  let start = 0;
  while (true) {
    const idx = buffer.indexOf(sep, start);
    if (idx === -1) break;
    const next = buffer.indexOf(sep, idx + sep.length);
    if (next === -1) break;
    const part = buffer.slice(idx + sep.length + 2, next - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) { start = next; continue; }
    const headerStr = part.slice(0, headerEnd).toString();
    const body = part.slice(headerEnd + 4);
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const fileMatch = headerStr.match(/filename="([^"]+)"/);
    const ctMatch   = headerStr.match(/Content-Type:\s*(\S+)/i);
    parts.push({
      name: nameMatch ? nameMatch[1] : '',
      filename: fileMatch ? fileMatch[1] : null,
      contentType: ctMatch ? ctMatch[1] : 'text/plain',
      data: body,
    });
    start = next;
  }
  return parts;
}

// ── HTML ─────────────────────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Gares Manager</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');

  :root {
    --bg: #0d0f14;
    --card: #161a22;
    --card2: #1e2330;
    --accent: #f5a623;
    --accent2: #e84545;
    --text: #eceef2;
    --muted: #6b7280;
    --border: #2a2f3d;
    --tab-active: #f5a623;
    --radius: 12px;
    --font-head: 'Bebas Neue', sans-serif;
    --font-body: 'DM Sans', sans-serif;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--font-body); min-height: 100vh; }

  header {
    background: linear-gradient(135deg,#1a1f2e 0%,#0d0f14 100%);
    border-bottom: 2px solid var(--accent);
    padding: 18px 20px;
    position: sticky; top: 0; z-index: 100;
    display: flex; align-items: center; gap: 12px;
  }
  header h1 { font-family: var(--font-head); font-size: 2rem; letter-spacing: 2px; color: var(--accent); }
  header span { font-size: .75rem; color: var(--muted); letter-spacing: 1px; text-transform: uppercase; }

  main { padding: 20px 16px 80px; max-width: 900px; margin: 0 auto; }

  .prestation-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin-bottom: 24px;
    overflow: hidden;
    box-shadow: 0 4px 24px rgba(0,0,0,.4);
    transition: box-shadow .2s;
  }
  .prestation-card:hover { box-shadow: 0 6px 32px rgba(245,166,35,.15); }

  .prestation-header {
    background: linear-gradient(90deg, var(--card2) 0%, var(--card) 100%);
    padding: 14px 18px;
    display: flex; align-items: center; gap: 10px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
  }
  .prestation-header .badge {
    background: var(--accent); color: #000;
    border-radius: 20px; padding: 2px 10px;
    font-size: .7rem; font-weight: 600; letter-spacing: 1px;
    text-transform: uppercase;
  }
  .prestation-header h2 {
    font-family: var(--font-head); font-size: 1.4rem; letter-spacing: 1.5px;
    flex: 1;
  }
  .prestation-header .chevron { transition: transform .25s; color: var(--muted); }
  .prestation-card.collapsed .chevron { transform: rotate(-90deg); }
  .prestation-card.collapsed .tabs-section { display: none; }

  .tabs-section { padding: 0; }

  .tab-bar {
    display: flex; flex-wrap: wrap; gap: 4px;
    padding: 12px 14px 0;
    border-bottom: 1px solid var(--border);
  }
  .tab-btn {
    background: none; border: 1px solid var(--border);
    color: var(--muted); padding: 6px 13px; border-radius: 8px 8px 0 0;
    font-family: var(--font-body); font-size: .78rem; font-weight: 500;
    cursor: pointer; transition: all .15s; white-space: nowrap;
    border-bottom: none;
  }
  .tab-btn:hover { color: var(--text); border-color: var(--accent); }
  .tab-btn.active {
    background: var(--accent); color: #000; border-color: var(--accent);
    font-weight: 700;
  }

  .tab-panel { display: none; padding: 18px; }
  .tab-panel.active { display: block; }

  .gare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
  @media(max-width:500px){ .gare-grid { grid-template-columns: 1fr; } }

  .gare-box {
    background: var(--bg); border: 1px solid var(--border);
    border-radius: 10px; padding: 14px;
  }
  .gare-box h4 { font-size: .65rem; text-transform: uppercase; letter-spacing: 1px; color: var(--accent); margin-bottom: 8px; }

  .scan-point {
    display: flex; align-items: center; gap: 8px;
    background: var(--card2); border-radius: 8px; padding: 8px 12px;
    font-size: .82rem; color: var(--text);
  }
  .scan-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }

  .products-list { margin-top: 0; }
  .product-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 7px 0; border-bottom: 1px solid var(--border); gap: 8px;
    font-size: .82rem;
  }
  .product-item:last-child { border-bottom: none; }
  .product-name { flex: 1; }
  .action-badge {
    font-size: .65rem; padding: 2px 8px; border-radius: 20px;
    font-weight: 600; letter-spacing: .5px; text-transform: uppercase;
  }
  .action-repor { background: rgba(72,199,142,.15); color: #48c78e; border: 1px solid #48c78e44; }
  .action-tirar { background: rgba(232,69,69,.15); color: var(--accent2); border: 1px solid #e8454544; }

  .add-product-form { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
  .add-product-form input, .add-product-form select {
    background: var(--card2); border: 1px solid var(--border); color: var(--text);
    border-radius: 8px; padding: 7px 10px; font-size: .8rem; font-family: var(--font-body);
    flex: 1; min-width: 80px;
  }
  .btn {
    background: var(--accent); color: #000; border: none;
    border-radius: 8px; padding: 7px 14px; font-size: .8rem;
    font-weight: 700; cursor: pointer; font-family: var(--font-body);
    transition: opacity .15s;
  }
  .btn:hover { opacity: .85; }
  .btn-danger { background: var(--accent2); color: #fff; }
  .btn-sm { padding: 4px 10px; font-size: .72rem; }

  /* Photos */
  .photos-section { margin-top: 12px; }
  .photos-section h4 { font-size: .65rem; text-transform: uppercase; letter-spacing: 1px; color: var(--accent); margin-bottom: 8px; }
  .photo-upload-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .photo-upload-row input[type=file] { display: none; }
  .photo-upload-label {
    background: var(--card2); border: 1px dashed var(--accent);
    color: var(--accent); border-radius: 8px; padding: 7px 14px;
    font-size: .8rem; cursor: pointer; font-weight: 600;
  }
  .note-input {
    background: var(--card2); border: 1px solid var(--border); color: var(--text);
    border-radius: 8px; padding: 7px 10px; font-size: .8rem; flex: 1;
    font-family: var(--font-body); min-width: 120px;
  }
  .photos-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .photo-thumb {
    position: relative; border-radius: 8px; overflow: hidden;
    border: 1px solid var(--border); width: 90px; height: 90px;
  }
  .photo-thumb img { width: 100%; height: 100%; object-fit: cover; cursor: pointer; }
  .photo-del {
    position: absolute; top: 3px; right: 3px;
    background: rgba(0,0,0,.7); border: none; color: #fff;
    border-radius: 50%; width: 22px; height: 22px; font-size: 14px;
    cursor: pointer; line-height: 22px; text-align: center; padding: 0;
  }
  .photo-note { font-size: .6rem; color: var(--muted); text-align: center; padding: 2px 4px; background: var(--bg); }

  /* Lightbox */
  #lightbox {
    display: none; position: fixed; inset: 0; background: rgba(0,0,0,.9);
    z-index: 999; justify-content: center; align-items: center;
  }
  #lightbox.open { display: flex; }
  #lightbox img { max-width: 95vw; max-height: 90vh; border-radius: 8px; }
  #lightbox-close { position: fixed; top: 16px; right: 20px; background: none; border: none; color: #fff; font-size: 2rem; cursor: pointer; }

  .status-ok { color: #48c78e; font-size: .72rem; }
  .status-warning { color: var(--accent2); font-size: .72rem; }

  /* Toast */
  #toast {
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: var(--accent); color: #000; padding: 10px 24px;
    border-radius: 20px; font-weight: 700; font-size: .85rem;
    display: none; z-index: 998;
  }
</style>
</head>
<body>
<header>
  <div>
    <h1>⚡ GARES</h1>
    <span>Gestão de Prestações</span>
  </div>
</header>
<main id="main">Carregando...</main>

<div id="lightbox">
  <button id="lightbox-close" onclick="closeLightbox()">✕</button>
  <img id="lightbox-img" src="" alt="">
</div>
<div id="toast"></div>

<script>
const API = async (url, opts={}) => {
  const r = await fetch(url, opts);
  return r.json();
};

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 2000);
}

function openLightbox(src) {
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
}

async function loadAll() {
  const data = await API('/api/data');
  renderAll(data);
}

function renderAll(data) {
  const main = document.getElementById('main');
  main.innerHTML = '';
  for (const prest of data) {
    main.appendChild(renderPrestation(prest));
  }
}

function renderPrestation(prest) {
  const card = document.createElement('div');
  card.className = 'prestation-card';
  card.dataset.id = prest.name;

  const header = document.createElement('div');
  header.className = 'prestation-header';
  header.innerHTML = \`
    <span class="badge">\${prest.gares.length} gares</span>
    <h2>\${prest.name}</h2>
    <span class="chevron">▼</span>
  \`;
  header.onclick = () => {
    card.classList.toggle('collapsed');
  };
  card.appendChild(header);

  const tabsSection = document.createElement('div');
  tabsSection.className = 'tabs-section';

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.className = 'tab-bar';

  // Panels container
  const panelsDiv = document.createElement('div');

  prest.gares.forEach((gare, i) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (i===0?' active':'');
    btn.textContent = gare.name;
    btn.dataset.idx = i;
    btn.onclick = () => {
      tabBar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      panelsDiv.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      panelsDiv.querySelectorAll('.tab-panel')[i].classList.add('active');
    };
    tabBar.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'tab-panel' + (i===0?' active':'');
    panel.innerHTML = renderGarePanel(gare);
    panelsDiv.appendChild(panel);

    // Bind events for this panel
    setTimeout(() => bindGareEvents(panel, gare), 0);
  });

  tabsSection.appendChild(tabBar);
  tabsSection.appendChild(panelsDiv);
  card.appendChild(tabsSection);
  return card;
}

function renderGarePanel(gare) {
  const photos = (gare.photos||[]).map(p => \`
    <div class="photo-thumb">
      <img src="/photos/\${p.filename}" onclick="openLightbox('/photos/\${p.filename}')" alt="">
      <button class="photo-del" onclick="deletePhoto(\${p.id}, this.closest('.photo-thumb'))">×</button>
      \${p.note ? \`<div class="photo-note">\${p.note}</div>\` : ''}
    </div>
  \`).join('');

  const products = (gare.products||[]).map(p => \`
    <div class="product-item" data-prod-id="\${p.id}">
      <span class="product-name">\${p.name}</span>
      <span class="action-badge action-\${p.action}">\${p.action}</span>
      <button class="btn btn-sm btn-danger" onclick="deleteProduct(\${p.id}, this)">✕</button>
    </div>
  \`).join('');

  return \`
    <div class="gare-grid">
      <div class="gare-box">
        <h4>📡 Ponto de Scan</h4>
        <div class="scan-point">
          <div class="scan-dot"></div>
          <span>\${gare.scan || 'Ponto de scan ' + gare.name}</span>
        </div>
      </div>
      <div class="gare-box">
        <h4>📦 Produtos</h4>
        <div class="products-list">\${products || '<span style="color:var(--muted);font-size:.8rem">Sem produtos</span>'}</div>
        <div class="add-product-form">
          <input class="prod-name-input" type="text" placeholder="Nome do produto">
          <select class="prod-action-select">
            <option value="repor">Repor</option>
            <option value="tirar">Tirar</option>
          </select>
          <button class="btn btn-sm" onclick="addProduct(\${gare.id}, this)">+</button>
        </div>
      </div>
    </div>
    <div class="photos-section">
      <h4>📷 Fotos (\${(gare.photos||[]).length})</h4>
      <div class="photo-upload-row">
        <label class="photo-upload-label">
          📷 Tirar / Escolher Foto
          <input type="file" accept="image/*" capture="environment" onchange="uploadPhoto(\${gare.id}, this)">
        </label>
        <input class="note-input" type="text" placeholder="Nota (opcional)" id="note-\${gare.id}">
      </div>
      <div class="photos-grid">\${photos}</div>
    </div>
  \`;
}

function bindGareEvents(panel, gare) {
  // events already inline
}

async function addProduct(gareId, btn) {
  const row = btn.closest('.add-product-form');
  const name = row.querySelector('.prod-name-input').value.trim();
  const action = row.querySelector('.prod-action-select').value;
  if (!name) return;
  const res = await API('/api/products', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({gare_id: gareId, name, action})
  });
  if (res.ok) {
    row.querySelector('.prod-name-input').value = '';
    toast('Produto adicionado!');
    loadAll();
  }
}

async function deleteProduct(id, btn) {
  const item = btn.closest('.product-item');
  const res = await API('/api/products/' + id, {method:'DELETE'});
  if (res.ok) { item.remove(); toast('Removido!'); }
}

async function deletePhoto(id, el) {
  const res = await API('/api/photos/' + id, {method:'DELETE'});
  if (res.ok) { el.remove(); toast('Foto removida!'); }
}

async function uploadPhoto(gareId, input) {
  const file = input.files[0];
  if (!file) return;
  const note = document.getElementById('note-' + gareId)?.value || '';
  const fd = new FormData();
  fd.append('photo', file);
  fd.append('gare_id', gareId);
  fd.append('note', note);
  const res = await API('/api/photos', {method:'POST', body: fd});
  if (res.ok) {
    toast('Foto guardada!');
    if (document.getElementById('note-' + gareId)) document.getElementById('note-' + gareId).value = '';
    loadAll();
  }
}

loadAll();
</script>
</body>
</html>`;

// ── Routes ────────────────────────────────────────────────────────────────────
async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // Static HTML
  if (req.method === 'GET' && p === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML);
  }

  // Photos
  if (req.method === 'GET' && p.startsWith('/photos/')) {
    const fname = path.basename(p);
    const fpath = path.join(PHOTOS_DIR, fname);
    if (fs.existsSync(fpath)) {
      const ext = path.extname(fname).toLowerCase();
      const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      return fs.createReadStream(fpath).pipe(res);
    }
    res.writeHead(404); return res.end('not found');
  }

  // API: get all data
  if (req.method === 'GET' && p === '/api/data') {
    const gares = db.prepare('SELECT * FROM gares ORDER BY id').all();
    const scans  = db.prepare('SELECT * FROM scan_points').all();
    const prods  = db.prepare('SELECT * FROM products').all();
    const photos = db.prepare('SELECT * FROM photos ORDER BY created_at DESC').all();

    // group by prestation
    const prestations = {};
    for (const g of gares) {
      if (!prestations[g.prestation]) prestations[g.prestation] = { name: g.prestation, gares: [] };
      prestations[g.prestation].gares.push({
        id: g.id,
        name: g.gare,
        scan: (scans.find(s => s.gare_id === g.id) || {}).label,
        products: prods.filter(pr => pr.gare_id === g.id),
        photos: photos.filter(ph => ph.gare_id === g.id),
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(Object.values(prestations)));
  }

  // API: add product
  if (req.method === 'POST' && p === '/api/products') {
    const body = await parseBody(req);
    const { gare_id, name, action } = JSON.parse(body.toString());
    db.prepare('INSERT INTO products (gare_id, name, action) VALUES (?,?,?)').run(gare_id, name, action || 'repor');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // API: delete product
  if (req.method === 'DELETE' && p.startsWith('/api/products/')) {
    const id = parseInt(p.split('/').pop());
    db.prepare('DELETE FROM products WHERE id=?').run(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // API: upload photo
  if (req.method === 'POST' && p === '/api/photos') {
    const body = await parseBody(req);
    const ct = req.headers['content-type'] || '';
    const boundaryMatch = ct.match(/boundary=(.+)/);
    if (!boundaryMatch) { res.writeHead(400); return res.end('no boundary'); }
    const parts = parseMultipart(body, boundaryMatch[1]);
    const filePart = parts.find(p => p.name === 'photo');
    const gareIdPart = parts.find(p => p.name === 'gare_id');
    const notePart = parts.find(p => p.name === 'note');
    if (!filePart || !gareIdPart) { res.writeHead(400); return res.end('missing'); }
    const gare_id = parseInt(gareIdPart.data.toString().trim());
    const note = notePart ? notePart.data.toString().trim() : '';
    const ext = path.extname(filePart.filename || '.jpg') || '.jpg';
    const fname = Date.now() + '_' + gare_id + ext;
    fs.writeFileSync(path.join(PHOTOS_DIR, fname), filePart.data);
    db.prepare('INSERT INTO photos (gare_id, filename, note) VALUES (?,?,?)').run(gare_id, fname, note);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, filename: fname }));
  }

  // API: delete photo
  if (req.method === 'DELETE' && p.startsWith('/api/photos/')) {
    const id = parseInt(p.split('/').pop());
    const row = db.prepare('SELECT filename FROM photos WHERE id=?').get(id);
    if (row) {
      const fpath = path.join(PHOTOS_DIR, row.filename);
      if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
      db.prepare('DELETE FROM photos WHERE id=?').run(id);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  res.writeHead(404); res.end('Not found');
}

const PORT = process.env.PORT || 3000;
http.createServer(handleRequest).listen(PORT, () => {
  console.log(\`✅ Gares Manager running → http://localhost:\${PORT}\`);
});
