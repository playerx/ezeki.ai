import './style.css';
import { loadListings, saveListing, getListing, newListing, StorageFullError } from './store.js';
import { fileToDataUrl, shrinkForStorage, dataUrlToApiImage } from './photos.js';

const CATEGORIES = ['furniture', 'kitchen', 'electronics', 'clothing', 'books', 'kids', 'garden', 'tools', 'sports', 'decor', 'other'];
const CONDITIONS = ['like new', 'good', 'fair', 'worn'];
const MAX_PHOTOS = 3;

const app = document.querySelector('#app');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function options(list, selected) {
  return list.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');
}

function timeAgo(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

// `back` is a hash to navigate to, or a function to run (for in-flow steps
// that share a route, where changing the hash would do nothing).
function layout(title, body, { back } = {}) {
  const backLink = typeof back === 'function'
    ? `<a class="back" href="#" id="back-link">&larr; Back</a>`
    : back ? `<a class="back" href="${back}">&larr; Back</a>` : '';
  app.innerHTML = `
    <header class="bar">
      ${backLink}
      <h1>${esc(title)}</h1>
    </header>
    <main>${body}</main>`;
  if (typeof back === 'function') {
    document.querySelector('#back-link').addEventListener('click', (e) => { e.preventDefault(); back(); });
  }
}

// ---------- Home ----------
function renderHome() {
  const listings = loadListings();
  const rows = listings.length
    ? listings.map((l) => `
        <a class="listing-row" href="#/listing/${l.id}">
          <img src="${l.photos[0] || ''}" alt="" />
          <div>
            <div class="title">${esc(l.title || 'Untitled')}</div>
            <div class="meta">Free &middot; ${esc(l.condition)} &middot; <span class="badge${l.status === 'listed' ? '' : ' muted'}">${esc(l.status)}</span></div>
          </div>
        </a>`).join('<hr class="row-sep">')
    : `<div class="empty">Nothing listed yet.<br>Give something away to get started.</div>`;

  layout('Giveaway', `
    <a class="btn primary" href="#/new">Give something away</a>
    <div class="card">${rows}</div>
  `);
}

// ---------- New listing ----------
const emptyDraft = () => ({ title: '', description: '', category: 'other', condition: 'good', pickupHints: [], isPhotoOfItem: true });
const draftState = { photos: [], draft: null, manual: false, serverStub: false, error: null, working: false };

function resetDraft() {
  Object.assign(draftState, { photos: [], draft: null, manual: false, serverStub: false, error: null, working: false });
}

function renderNew() {
  if (!draftState.draft) return renderPhotoStep();
  return renderEditStep();
}

function renderPhotoStep() {
  const s = draftState;
  const photos = s.photos.map((p, i) => `
    <div class="thumb"><img src="${p}" alt="" /><button type="button" class="remove" data-i="${i}" aria-label="Remove photo">&times;</button></div>`).join('');
  const add = s.photos.length === 0
    ? `<label class="add big" for="photo-input"><span>&#128247;</span><span>Take or choose photos</span></label>`
    : s.photos.length < MAX_PHOTOS ? `<label class="add" for="photo-input">+</label>` : '';

  layout('New listing', `
    <p class="muted">Snap a photo. We'll draft the listing, you fix anything that's wrong.</p>
    <div class="photo-grid">${photos}${add}</div>
    <input id="photo-input" type="file" accept="image/*" capture="environment" multiple />
    ${s.error ? `<div class="notice error">${esc(s.error)}</div>` : ''}
    ${s.working ? `<div class="notice working">Drafting your listing&hellip;</div>` : ''}
    <div class="sticky-actions">
      <button class="btn primary" id="draft-btn" ${s.photos.length === 0 || s.working ? 'disabled' : ''}>Draft listing</button>
      ${s.photos.length > 0 && !s.working ? `<button class="btn ghost" id="manual-btn">Fill in the details myself</button>` : ''}
    </div>
  `, { back: '#/' });

  document.querySelector('#photo-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files).slice(0, MAX_PHOTOS - s.photos.length);
    for (const f of files) s.photos.push(await fileToDataUrl(f));
    s.error = null;
    renderNew();
  });
  document.querySelectorAll('.thumb .remove').forEach((b) => b.addEventListener('click', () => {
    s.photos.splice(Number(b.dataset.i), 1);
    renderNew();
  }));
  document.querySelector('#draft-btn').addEventListener('click', requestDraft);
  document.querySelector('#manual-btn')?.addEventListener('click', () => {
    s.draft = emptyDraft();
    s.manual = true;
    s.error = null;
    renderNew();
  });
}

async function requestDraft() {
  const s = draftState;
  s.working = true;
  s.error = null;
  renderNew();
  try {
    const res = await fetch('/api/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: s.photos.map(dataUrlToApiImage) }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `Draft failed (${res.status})`);
    s.draft = body.draft;
    s.serverStub = Boolean(body.stub);
    s.manual = false;
  } catch (err) {
    s.error = `${err.message}. You can try again or fill in the details yourself.`;
  } finally {
    s.working = false;
    renderNew();
  }
}

function editNotice(s, d) {
  if (s.serverStub) return `<div class="notice">AI drafting is off because no API key is set on the server. Fill in the details yourself.</div>`;
  if (s.manual) return `<p class="muted">Fill in the details yourself.</p>`;
  if (d.isPhotoOfItem === false) {
    return `<div class="notice error">
      This doesn't look like a photo of the actual item (a drawing, screenshot or catalog image). People need to see the real thing.
      <button type="button" class="btn" id="retake-btn">Retake photo</button>
    </div>`;
  }
  return `<p class="muted">Drafted from your photos. Fix anything that's wrong.</p>`;
}

function renderEditStep() {
  const s = draftState;
  const d = s.draft;
  const hints = (d.pickupHints || []).join('. ');

  layout('Check the details', `
    ${editNotice(s, d)}
    <div class="photo-grid">${s.photos.map((p) => `<img src="${p}" alt="" />`).join('')}</div>
    <form id="edit-form" style="display:contents">
      <div class="field"><label for="f-title">Title</label><input id="f-title" name="title" required maxlength="80" value="${esc(d.title)}" /></div>
      <div class="field"><label for="f-desc">Description</label><textarea id="f-desc" name="description">${esc(d.description)}</textarea></div>
      <div class="row">
        <div class="field"><label for="f-cat">Category</label><select id="f-cat" name="category">${options(CATEGORIES, d.category)}</select></div>
        <div class="field"><label for="f-cond">Condition</label><select id="f-cond" name="condition">${options(CONDITIONS, d.condition)}</select></div>
      </div>
      <div class="field"><label for="f-pickup">Pickup notes</label><input id="f-pickup" name="pickupNotes" placeholder="Porch pickup, buzz apt 3, heavy&hellip;" value="${esc(hints)}" /></div>
      ${s.error ? `<div class="notice error">${esc(s.error)}</div>` : ''}
      <div class="sticky-actions"><button class="btn primary" type="submit" id="post-btn">Post for free</button></div>
    </form>
  `, { back: () => { s.draft = null; s.error = null; renderNew(); } });

  document.querySelector('#retake-btn')?.addEventListener('click', () => {
    Object.assign(s, { draft: null, photos: [], error: null });
    renderNew();
  });

  document.querySelector('#edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = document.querySelector('#post-btn');
    btn.disabled = true;
    btn.textContent = 'Posting…';
    try {
      const listing = newListing({
        photos: await Promise.all(s.photos.map(shrinkForStorage)),
        title: f.get('title').trim(),
        description: f.get('description').trim(),
        category: f.get('category'),
        condition: f.get('condition'),
        pickupNotes: f.get('pickupNotes').trim(),
        price: null,
        aiDraft: s.manual || s.serverStub ? null : d,
      });
      saveListing(listing);
      resetDraft();
      location.hash = `#/listing/${listing.id}`;
    } catch (err) {
      s.error = err instanceof StorageFullError ? err.message : `Could not save the listing: ${err.message}`;
      // Keep what the user typed: re-render with their edits as the draft.
      s.draft = { ...d, title: f.get('title'), description: f.get('description'), category: f.get('category'), condition: f.get('condition'), pickupHints: [f.get('pickupNotes')] };
      renderNew();
    }
  });
}

// ---------- Listing detail ----------
function renderListing(id) {
  const l = getListing(id);
  if (!l) return layout('Not found', `<div class="empty">That listing doesn't exist.</div>`, { back: '#/' });

  layout('Listing', `
    <div class="card">
      <img class="hero" src="${l.photos[0] || ''}" alt="" />
      ${l.photos.length > 1 ? `<div class="thumbs">${l.photos.map((p) => `<img src="${p}" alt="" />`).join('')}</div>` : ''}
      <div class="detail">
        <div class="price">Free</div>
        <h2>${esc(l.title)}</h2>
        <div class="kv"><span class="badge">${esc(l.status)}</span><span>${esc(l.category)}</span><span>&middot;</span><span>${esc(l.condition)}</span><span>&middot;</span><span>posted ${timeAgo(l.createdAt)}</span></div>
        <p>${esc(l.description)}</p>
        ${l.pickupNotes ? `<div><strong>Pickup:</strong> ${esc(l.pickupNotes)}</div>` : ''}
      </div>
    </div>
    <a class="btn ghost" href="#/">Done</a>
  `, { back: '#/' });
}

// ---------- Router ----------
function route() {
  const hash = location.hash || '#/';
  const m = hash.match(/^#\/listing\/(.+)$/);
  if (hash === '#/new') return renderNew();
  if (m) return renderListing(m[1]);
  resetDraft();
  renderHome();
}

window.addEventListener('hashchange', route);
route();
