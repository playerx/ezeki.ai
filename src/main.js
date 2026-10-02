import './style.css';
import { loadListings, saveListing, getListing, newListing, StorageFullError, loadGiverDefaults, saveGiverDefaults } from './store.js';
import { fileToDataUrl, shrinkForStorage, dataUrlToApiImage } from './photos.js';

const CATEGORIES = ['furniture', 'kitchen', 'electronics', 'clothing', 'books', 'kids', 'garden', 'tools', 'sports', 'decor', 'other'];
const CONDITIONS = ['like new', 'good', 'fair', 'worn'];
const MAX_PHOTOS = 3;
const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const PARTS = [['am', 'Morning', '8–12'], ['pm', 'Afternoon', '12–5'], ['eve', 'Evening', '5–9']];

function slotLabel(slot) {
  const [d, p] = slot.split('-');
  const day = DAYS.find(([k]) => k === d)?.[1] ?? d;
  const part = PARTS.find(([k]) => k === p)?.[1]?.toLowerCase() ?? p;
  return `${day} ${part}`;
}

function pickupNotesOf(l) {
  return l.pickup?.notes ?? l.pickupNotes ?? '';
}

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
            <div class="meta">Free &middot; ${esc(l.condition)}${l.pickup?.area ? ' &middot; ' + esc(l.pickup.area) : ''} &middot; <span class="badge${l.status === 'listed' ? '' : ' muted'}">${esc(l.status)}</span></div>
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
const freshState = () => ({ step: 'photo', photos: [], draft: null, details: null, pickup: null, manual: false, serverStub: false, error: null, working: false });
const draftState = freshState();

function resetDraft() {
  Object.assign(draftState, freshState());
}

function renderNew() {
  if (draftState.step === 'pickup') return renderPickupStep();
  if (draftState.step === 'edit') return renderEditStep();
  return renderPhotoStep();
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
    s.step = 'edit';
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
    s.step = 'edit';
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
  const d = s.details ? { ...s.draft, ...s.details } : s.draft;

  layout('Check the details', `
    ${editNotice(s, s.draft)}
    <div class="photo-grid">${s.photos.map((p) => `<img src="${p}" alt="" />`).join('')}</div>
    <form id="edit-form" style="display:contents">
      <div class="field"><label for="f-title">Title</label><input id="f-title" name="title" required maxlength="80" value="${esc(d.title)}" /></div>
      <div class="field"><label for="f-desc">Description</label><textarea id="f-desc" name="description">${esc(d.description)}</textarea></div>
      <div class="row">
        <div class="field"><label for="f-cat">Category</label><select id="f-cat" name="category">${options(CATEGORIES, d.category)}</select></div>
        <div class="field"><label for="f-cond">Condition</label><select id="f-cond" name="condition">${options(CONDITIONS, d.condition)}</select></div>
      </div>
      <div class="sticky-actions"><button class="btn primary" type="submit">Next: pickup</button></div>
    </form>
  `, { back: () => { s.step = 'photo'; s.error = null; renderNew(); } });

  document.querySelector('#retake-btn')?.addEventListener('click', () => {
    Object.assign(s, { step: 'photo', draft: null, details: null, photos: [], error: null });
    renderNew();
  });

  document.querySelector('#edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    s.details = {
      title: f.get('title').trim(),
      description: f.get('description').trim(),
      category: f.get('category'),
      condition: f.get('condition'),
    };
    s.step = 'pickup';
    renderNew();
  });
}

// Step 3: where and when. Area is public, the exact address is only shared once
// a pickup is confirmed (next slice). Availability windows are what a recipient
// will pick a slot from.
function renderPickupStep() {
  const s = draftState;
  if (!s.pickup) {
    const defaults = loadGiverDefaults() || {};
    s.pickup = {
      area: defaults.area || '',
      address: defaults.address || '',
      availability: Array.isArray(defaults.availability) ? [...defaults.availability] : [],
      notes: (s.draft.pickupHints || []).join('. '),
      remember: true,
    };
  }
  const p = s.pickup;
  const grid = `
    <div class="avail" role="group" aria-label="Pickup availability">
      <span></span>${PARTS.map(([, name, hours]) => `<span class="hd">${name}<br>${hours}</span>`).join('')}
      ${DAYS.map(([dk, dname]) => `<span class="day">${dname}</span>` + PARTS.map(([pk]) => {
        const slot = `${dk}-${pk}`;
        return `<button type="button" class="chip" data-slot="${slot}" aria-pressed="${p.availability.includes(slot)}" aria-label="${dname} ${pk}">${p.availability.includes(slot) ? '&#10003;' : ''}</button>`;
      }).join('')).join('')}
    </div>`;

  layout('Pickup', `
    <p class="muted">Where and when can someone collect it?</p>
    <form id="pickup-form" style="display:contents">
      <div class="field"><label for="p-area">Area <span class="small">(shown on the listing)</span></label><input id="p-area" name="area" required maxlength="60" placeholder="Neighbourhood or postcode" value="${esc(p.area)}" /></div>
      <div class="field"><label for="p-address">Pickup address <span class="small">(only shared once a pickup is confirmed)</span></label><input id="p-address" name="address" required maxlength="120" placeholder="Street address" value="${esc(p.address)}" /></div>
      <div class="field"><label>When are you usually around?</label>${grid}</div>
      <label class="check"><input type="checkbox" id="p-remember" ${p.remember ? 'checked' : ''} /> Remember area, address and availability for next time</label>
      <div class="field"><label for="p-notes">Pickup notes</label><input id="p-notes" name="notes" maxlength="200" placeholder="Porch pickup, buzz apt 3, heavy&hellip;" value="${esc(p.notes)}" /></div>
      ${s.error ? `<div class="notice error">${esc(s.error)}</div>` : ''}
      <div class="sticky-actions"><button class="btn primary" type="submit" id="post-btn">Post for free</button></div>
    </form>
  `, { back: () => { capturePickupForm(); s.step = 'edit'; s.error = null; renderNew(); } });

  document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = on ? '&#10003;' : '';
  }));

  function capturePickupForm() {
    p.area = document.querySelector('#p-area').value.trim();
    p.address = document.querySelector('#p-address').value.trim();
    p.notes = document.querySelector('#p-notes').value.trim();
    p.remember = document.querySelector('#p-remember').checked;
    p.availability = Array.from(document.querySelectorAll('.chip[aria-pressed="true"]')).map((b) => b.dataset.slot);
  }

  document.querySelector('#pickup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    capturePickupForm();
    if (p.availability.length === 0) {
      s.error = 'Pick at least one time window so people know when they can collect.';
      return renderNew();
    }
    const btn = document.querySelector('#post-btn');
    btn.disabled = true;
    btn.textContent = 'Posting…';
    try {
      const listing = newListing({
        photos: await Promise.all(s.photos.map(shrinkForStorage)),
        ...s.details,
        pickup: { area: p.area, address: p.address, availability: p.availability, notes: p.notes },
        price: null,
        aiDraft: s.manual || s.serverStub ? null : s.draft,
      });
      saveListing(listing);
      if (p.remember) saveGiverDefaults({ area: p.area, address: p.address, availability: p.availability });
      resetDraft();
      location.hash = `#/listing/${listing.id}`;
    } catch (err) {
      s.error = err instanceof StorageFullError ? err.message : `Could not save the listing: ${err.message}`;
      renderNew();
    }
  });
}

// ---------- Listing detail ----------
function pickupBlock(l) {
  const p = l.pickup;
  const notes = pickupNotesOf(l);
  if (!p) return notes ? `<div><strong>Pickup:</strong> ${esc(notes)}</div>` : '';
  return `
    <div class="pickup">
      <div><strong>Pickup in ${esc(p.area)}</strong><br><span class="muted small">Exact address is shared once a pickup is confirmed.</span></div>
      <div class="chips">${p.availability.map((slot) => `<span class="tag">${esc(slotLabel(slot))}</span>`).join('')}</div>
      ${notes ? `<div>${esc(notes)}</div>` : ''}
    </div>`;
}

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
        ${pickupBlock(l)}
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
