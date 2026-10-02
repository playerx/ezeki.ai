import './style.css';
import {
  loadListings, saveListing, getListing, deleteListing, newListing, StorageFullError,
  loadGiverDefaults, saveGiverDefaults, loadDraft, saveDraft, clearDraft,
} from './store.js';
import { fileToDataUrl, shrinkForStorage, dataUrlToApiImage } from './photos.js';
import { renderAreaMap, osmLink, geocode } from './map.js';

const CATEGORIES = ['furniture', 'kitchen', 'electronics', 'clothing', 'books', 'kids', 'garden', 'tools', 'sports', 'decor', 'other'];
const CONDITIONS = ['like new', 'good', 'fair', 'worn'];
const MAX_PHOTOS = 3;
const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const PARTS = [['am', 'Morning', '8–12'], ['pm', 'Afternoon', '12–5'], ['eve', 'Evening', '5–9']];
const NEW_DRAFT_KEY = 'giveaway.draft';
const EDIT_DRAFT_KEY = 'giveaway.draft.edit';

const app = document.querySelector('#app');

// ---------- helpers ----------
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

function slotLabel(slot) {
  const [d, p] = slot.split('-');
  const day = DAYS.find(([k]) => k === d)?.[1] ?? d;
  const part = PARTS.find(([k]) => k === p)?.[1]?.toLowerCase() ?? p;
  return `${day} ${part}`;
}

function pickupNotesOf(l) {
  return l.pickup?.notes ?? l.pickupNotes ?? '';
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
  // Textareas grow with their content so nothing is hidden behind a scrollbar.
  document.querySelectorAll('textarea').forEach((t) => {
    const grow = () => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; };
    t.addEventListener('input', grow);
    grow();
  });
}

// ---------- Draft state ----------
// Two independent in-progress drafts: a new listing and an edit of an existing
// one. Both persist to localStorage so a refresh or a detour keeps the work.
const emptyDraft = () => ({ title: '', description: '', category: 'other', condition: 'good', pickupHints: [], isPhotoOfItem: true });
const freshState = () => ({ step: 'photo', editingId: null, photos: [], draft: null, details: null, pickup: null, manual: false, serverStub: false, error: null, working: false });

function restoreState(key) {
  const st = Object.assign(freshState(), loadDraft(key) || {});
  st.error = null;
  st.working = false;
  return st;
}

const newState = restoreState(NEW_DRAFT_KEY);
const editState = restoreState(EDIT_DRAFT_KEY);
let S = newState; // the draft currently on screen

function stateKey(st) { return st.editingId ? EDIT_DRAFT_KEY : NEW_DRAFT_KEY; }

let persistTimer;
function persistDraft(immediate = false) {
  clearTimeout(persistTimer);
  const st = S;
  const write = () => { const { error, working, ...rest } = st; saveDraft(stateKey(st), rest); };
  if (immediate) write(); else persistTimer = setTimeout(write, 300);
}

function resetState(st) {
  clearDraft(stateKey(st));
  Object.assign(st, freshState());
}

function hasUnfinishedListing() {
  return newState.photos.length > 0 || Boolean(newState.details);
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

  const banner = hasUnfinishedListing()
    ? `<div class="banner" id="resume-banner"><span>You have an unfinished listing.</span><a href="#/new">Resume</a><button type="button" id="discard-draft">Discard</button></div>`
    : '';

  layout('Giveaway', `
    ${banner}
    <a class="btn primary" href="#/new">Give something away</a>
    <div class="card">${rows}</div>
  `);

  document.querySelector('#discard-draft')?.addEventListener('click', () => {
    resetState(newState);
    renderHome();
  });
}

// ---------- New / edit listing flow ----------
function renderFlow() {
  persistDraft();
  if (S.step === 'review') return renderReviewStep();
  if (S.step === 'pickup') return renderPickupStep();
  if (S.step === 'edit') return renderEditStep();
  return renderPhotoStep();
}

function flowBackTarget() {
  return S.editingId ? `#/listing/${S.editingId}` : '#/';
}

function renderPhotoStep() {
  const s = S;
  const photos = s.photos.map((p, i) => `
    <div class="thumb"><img src="${p}" alt="" /><button type="button" class="remove" data-i="${i}" aria-label="Remove photo">&times;</button></div>`).join('');
  const add = s.photos.length === 0
    ? `<label class="add big" for="photo-input"><span>&#128247;</span><span>Take or choose photos</span></label>`
    : s.photos.length < MAX_PHOTOS ? `<label class="add" for="photo-input">+</label>` : '';
  const editing = Boolean(s.editingId);

  layout(editing ? 'Photos' : 'New listing', `
    <p class="muted">${editing ? 'Add or remove photos.' : "Snap a photo. We'll draft the listing, you fix anything that's wrong."}</p>
    <div class="photo-grid">${photos}${add}</div>
    <input id="photo-input" type="file" accept="image/*" capture="environment" multiple />
    ${s.error ? `<div class="notice error">${esc(s.error)}</div>` : ''}
    ${s.working ? `<div class="notice working">Drafting your listing&hellip;</div>` : ''}
    <div class="sticky-actions">
      ${editing
        ? `<button class="btn primary" id="next-btn" ${s.photos.length === 0 ? 'disabled' : ''}>Next: details</button>`
        : `<button class="btn primary" id="draft-btn" ${s.photos.length === 0 || s.working ? 'disabled' : ''}>Draft listing</button>
           ${s.photos.length > 0 && !s.working ? `<button class="btn ghost" id="manual-btn">Fill in the details myself</button>` : ''}`}
    </div>
  `, { back: editing ? () => { s.step = 'edit'; renderFlow(); } : '#/' });

  document.querySelector('#photo-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files).slice(0, MAX_PHOTOS - s.photos.length);
    for (const f of files) s.photos.push(await fileToDataUrl(f));
    s.error = null;
    renderFlow();
  });
  document.querySelectorAll('.thumb .remove').forEach((b) => b.addEventListener('click', () => {
    s.photos.splice(Number(b.dataset.i), 1);
    renderFlow();
  }));
  document.querySelector('#draft-btn')?.addEventListener('click', requestDraft);
  document.querySelector('#next-btn')?.addEventListener('click', () => { s.step = 'edit'; renderFlow(); });
  document.querySelector('#manual-btn')?.addEventListener('click', () => {
    s.draft = emptyDraft();
    s.manual = true;
    s.step = 'edit';
    s.error = null;
    renderFlow();
  });
}

async function requestDraft() {
  const s = S;
  s.working = true;
  s.error = null;
  renderFlow();
  try {
    const res = await fetch('/api/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: s.photos.map(dataUrlToApiImage) }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `Draft failed (${res.status})`);
    s.draft = body.draft;
    s.details = null; // a fresh draft replaces earlier edits
    s.serverStub = Boolean(body.stub);
    s.manual = false;
    s.step = 'edit';
  } catch (err) {
    s.error = `${err.message}. You can try again or fill in the details yourself.`;
  } finally {
    s.working = false;
    renderFlow();
  }
}

function editNotice(s) {
  if (s.editingId) return `<p class="muted">Editing your listing.</p>`;
  if (s.serverStub) return `<div class="notice">AI drafting is off because no API key is set on the server. Fill in the details yourself.</div>`;
  if (s.manual) return `<p class="muted">Fill in the details yourself.</p>`;
  if (s.draft?.isPhotoOfItem === false) {
    return `<div class="notice error">
      This doesn't look like a photo of the actual item (a drawing, screenshot or catalog image). People need to see the real thing.
      <button type="button" class="btn" id="retake-btn">Retake photo</button>
    </div>`;
  }
  return `<p class="muted">Drafted from your photos. Fix anything that's wrong.</p>`;
}

function renderEditStep() {
  const s = S;
  const d = { ...(s.draft || emptyDraft()), ...(s.details || {}) };

  layout('Check the details', `
    ${editNotice(s)}
    <div class="photo-grid">${s.photos.map((p) => `<img src="${p}" alt="" />`).join('')}</div>
    ${s.editingId ? `<a class="edit-link" href="#" id="photos-link">Change photos</a>` : ''}
    <form id="edit-form" style="display:contents">
      <div class="field"><label for="f-title">Title</label><input id="f-title" name="title" required maxlength="80" value="${esc(d.title)}" /></div>
      <div class="field"><label for="f-desc">Description</label><textarea id="f-desc" name="description" class="desc">${esc(d.description)}</textarea></div>
      <div class="row">
        <div class="field"><label for="f-cat">Category</label><select id="f-cat" name="category">${options(CATEGORIES, d.category)}</select></div>
        <div class="field"><label for="f-cond">Condition</label><select id="f-cond" name="condition">${options(CONDITIONS, d.condition)}</select></div>
      </div>
      <div class="sticky-actions"><button class="btn primary" type="submit">Next: pickup</button></div>
    </form>
  `, {
    back: s.editingId
      ? () => { resetState(editState); location.hash = `#/listing/${s.editingId}`; }
      : () => { captureDetails(); s.step = 'photo'; s.error = null; renderFlow(); },
  });

  function captureDetails() {
    const f = new FormData(document.querySelector('#edit-form'));
    s.details = {
      title: String(f.get('title')).trim(),
      description: String(f.get('description')).trim(),
      category: f.get('category'),
      condition: f.get('condition'),
    };
  }

  document.querySelector('#edit-form').addEventListener('input', () => { captureDetails(); persistDraft(); });
  document.querySelector('#photos-link')?.addEventListener('click', (e) => { e.preventDefault(); captureDetails(); s.step = 'photo'; renderFlow(); });
  document.querySelector('#retake-btn')?.addEventListener('click', () => {
    Object.assign(s, { step: 'photo', draft: null, details: null, photos: [], error: null });
    renderFlow();
  });
  document.querySelector('#edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    captureDetails();
    s.step = 'pickup';
    renderFlow();
  });
}

// Where and when. Area is public, the exact address is only shared once a
// pickup is confirmed. Availability windows are what a recipient picks from.
function renderPickupStep() {
  const s = S;
  if (!s.pickup) {
    const defaults = loadGiverDefaults() || {};
    s.pickup = {
      area: defaults.area || '',
      address: defaults.address || '',
      availability: Array.isArray(defaults.availability) ? [...defaults.availability] : [],
      location: defaults.location || null,
      notes: (s.draft?.pickupHints || []).join('. '),
      remember: true,
    };
  }
  const p = s.pickup;
  const grid = `
    <div class="avail" role="group" aria-label="Pickup availability">
      <span></span>${PARTS.map(([, name, hours]) => `<span class="hd">${name}<br>${hours}</span>`).join('')}
      ${DAYS.map(([dk, dname]) => `<span class="day">${dname}</span>` + PARTS.map(([pk]) => {
        const slot = `${dk}-${pk}`;
        const on = p.availability.includes(slot);
        return `<button type="button" class="chip" data-slot="${slot}" aria-pressed="${on}" aria-label="${dname} ${pk}">${on ? '&#10003;' : ''}</button>`;
      }).join('')).join('')}
    </div>`;

  layout('Pickup', `
    <p class="muted">Where and when can someone collect it?</p>
    <form id="pickup-form" style="display:contents">
      <div class="field">
        <label for="p-area">Area <span class="small">(shown on the listing)</span></label>
        <input id="p-area" name="area" required maxlength="80" autocomplete="off" placeholder="Neighbourhood or postcode" value="${esc(p.area)}" />
        <div id="area-suggest" class="suggest"></div>
        ${p.location
          ? `<div id="area-map" class="map"></div><div class="hint">People see this rough circle, never your address.</div>`
          : `<div class="hint">Type a neighbourhood or postcode and pick the match, so people can see the area on a map.</div>`}
      </div>
      <div class="field"><label for="p-address">Pickup address <span class="small">(only shared once a pickup is confirmed)</span></label><input id="p-address" name="address" required maxlength="120" placeholder="Street address" value="${esc(p.address)}" /></div>
      <div class="field"><label>When are you usually around?</label>${grid}</div>
      <label class="check"><input type="checkbox" id="p-remember" ${p.remember ? 'checked' : ''} /> Remember area, address and availability for next time</label>
      <div class="field"><label for="p-notes">Pickup notes</label><textarea id="p-notes" name="notes" maxlength="400" placeholder="Porch pickup, buzz apt 3, heavy&hellip;">${esc(p.notes)}</textarea></div>
      ${s.error ? `<div class="notice error">${esc(s.error)}</div>` : ''}
      <div class="sticky-actions"><button class="btn primary" type="submit">Next: review</button></div>
    </form>
  `, { back: () => { capturePickupForm(); s.step = 'edit'; s.error = null; renderFlow(); } });

  function capturePickupForm() {
    p.area = document.querySelector('#p-area').value.trim();
    p.address = document.querySelector('#p-address').value.trim();
    p.notes = document.querySelector('#p-notes').value.trim();
    p.remember = document.querySelector('#p-remember').checked;
    p.availability = Array.from(document.querySelectorAll('.chip[aria-pressed="true"]')).map((b) => b.dataset.slot);
  }

  document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = on ? '&#10003;' : '';
    capturePickupForm();
    persistDraft();
  }));
  document.querySelector('#pickup-form').addEventListener('input', () => { capturePickupForm(); persistDraft(); });

  // Area lookup: suggestions appear as you type; picking one pins the rough
  // location. Editing the text afterwards unpins it until a new pick.
  const areaInput = document.querySelector('#p-area');
  const suggestEl = document.querySelector('#area-suggest');
  let lookupTimer;
  areaInput.addEventListener('input', () => {
    const q = areaInput.value.trim();
    if (p.location && q !== p.location.label) {
      p.location = null;
      document.querySelector('#area-map')?.remove();
    }
    clearTimeout(lookupTimer);
    if (q.length < 3) { suggestEl.innerHTML = ''; return; }
    lookupTimer = setTimeout(async () => {
      const results = await geocode(q);
      if (areaInput.value.trim() !== q) return; // stale
      suggestEl.innerHTML = results.length
        ? results.map((r, i) => `<button type="button" data-i="${i}">${esc(r.label)}</button>`).join('')
        : `<div class="hint">No match found. You can still post with just the text.</div>`;
      suggestEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const r = results[Number(b.dataset.i)];
        capturePickupForm();
        p.area = r.label;
        p.location = { lat: r.lat, lon: r.lon, label: r.label };
        renderFlow();
      }));
    }, 400);
  });
  if (p.location) renderAreaMap(document.querySelector('#area-map'), p.location);

  document.querySelector('#pickup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    capturePickupForm();
    if (p.availability.length === 0) {
      s.error = 'Pick at least one time window so people know when they can collect.';
      return renderFlow();
    }
    s.error = null;
    s.step = 'review';
    renderFlow();
  });
}

// Last look before it goes live (or before changes are saved).
function renderReviewStep() {
  const s = S;
  const d = { ...(s.draft || emptyDraft()), ...(s.details || {}) };
  const p = s.pickup;
  const editing = Boolean(s.editingId);

  layout(editing ? 'Review changes' : 'Review, then list it', `
    <p class="muted">${editing ? 'This is how your listing will look.' : 'This is what people will see. Tap a section to change it.'}</p>
    <div class="card" id="review">
      <img class="hero" src="${s.photos[0] || ''}" alt="" />
      ${s.photos.length > 1 ? `<div class="thumbs">${s.photos.map((x) => `<img src="${x}" alt="" />`).join('')}</div>` : ''}
      <div class="detail">
        <div class="review-head"><div class="price">Free</div><a class="edit-link" href="#" data-goto="photo">Change photos</a></div>
        <h2>${esc(d.title)}</h2>
        <div class="kv"><span>${esc(d.category)}</span><span>&middot;</span><span>${esc(d.condition)}</span></div>
        <p>${esc(d.description)}</p>
        <a class="edit-link" href="#" data-goto="edit">Edit details</a>
        <div class="pickup">
          <div><strong>Pickup in ${esc(p.area)}</strong><br><span class="muted small">Exact address is shared once a pickup is confirmed.</span></div>
          ${p.location ? `<div id="review-map" class="map"></div>` : ''}
          <div class="chips">${p.availability.map((slot) => `<span class="tag">${esc(slotLabel(slot))}</span>`).join('')}</div>
          ${p.notes ? `<div class="notes">${esc(p.notes)}</div>` : ''}
          <div class="private">Address, private until a pickup is confirmed: ${esc(p.address)}</div>
          <a class="edit-link" href="#" data-goto="pickup">Edit pickup</a>
        </div>
      </div>
    </div>
    ${s.error ? `<div class="notice error">${esc(s.error)}</div>` : ''}
    <div class="sticky-actions"><button class="btn primary" id="post-btn">${editing ? 'Save changes' : 'List it'}</button></div>
  `, { back: () => { s.step = 'pickup'; renderFlow(); } });

  if (p.location) renderAreaMap(document.querySelector('#review-map'), p.location);

  document.querySelectorAll('[data-goto]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    s.step = a.dataset.goto;
    renderFlow();
  }));

  document.querySelector('#post-btn').addEventListener('click', async () => {
    const btn = document.querySelector('#post-btn');
    btn.disabled = true;
    btn.textContent = editing ? 'Saving…' : 'Listing…';
    try {
      const existing = editing ? getListing(s.editingId) : null;
      // Photos already in storage are kept as they are; new ones get shrunk.
      const kept = new Set(existing?.photos || []);
      const photos = await Promise.all(s.photos.map((x) => (kept.has(x) ? x : shrinkForStorage(x))));
      const fields = {
        photos,
        ...s.details,
        pickup: { area: p.area, address: p.address, availability: p.availability, notes: p.notes, location: p.location },
        price: null,
      };
      const listing = existing
        ? { ...existing, ...fields, updatedAt: new Date().toISOString() }
        : newListing({ ...fields, aiDraft: s.manual || s.serverStub ? null : s.draft });
      saveListing(listing);
      if (p.remember) saveGiverDefaults({ area: p.area, address: p.address, availability: p.availability, location: p.location });
      resetState(s);
      location.hash = `#/listing/${listing.id}`;
    } catch (err) {
      s.error = err instanceof StorageFullError ? err.message : `Could not save the listing: ${err.message}`;
      renderFlow();
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
      ${p.location ? `<div id="listing-map" class="map"></div><a class="map-link" href="${osmLink(p.location)}" target="_blank" rel="noopener">Open in OpenStreetMap</a>` : ''}
      <div class="chips">${p.availability.map((slot) => `<span class="tag">${esc(slotLabel(slot))}</span>`).join('')}</div>
      ${notes ? `<div class="notes">${esc(notes)}</div>` : ''}
    </div>`;
}

function renderListing(id) {
  const l = getListing(id);
  if (!l) return layout('Not found', `<div class="empty">That listing doesn't exist.</div>`, { back: '#/' });

  // No accounts yet, so every listing in this browser belongs to this giver.
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
    <div class="actions-row">
      <a class="btn" href="#/listing/${l.id}/edit">Edit listing</a>
      <button class="btn danger" id="delete-btn">Remove</button>
    </div>
    <a class="btn ghost" href="#/">Done</a>
  `, { back: '#/' });

  if (l.pickup?.location) renderAreaMap(document.querySelector('#listing-map'), l.pickup.location);

  document.querySelector('#delete-btn').addEventListener('click', () => {
    if (!confirm('Remove this listing? This cannot be undone.')) return;
    deleteListing(l.id);
    if (editState.editingId === l.id) resetState(editState);
    location.hash = '#/';
  });
}

function startEdit(id) {
  const l = getListing(id);
  if (!l) return layout('Not found', `<div class="empty">That listing doesn't exist.</div>`, { back: '#/' });
  if (editState.editingId !== id) {
    Object.assign(editState, freshState(), {
      editingId: id,
      step: 'edit',
      photos: [...l.photos],
      draft: l.aiDraft || emptyDraft(),
      details: { title: l.title, description: l.description, category: l.category, condition: l.condition },
      pickup: l.pickup ? { ...l.pickup, remember: false } : null,
      manual: !l.aiDraft,
    });
  }
  S = editState;
  renderFlow();
}

// ---------- Router ----------
function route() {
  const hash = location.hash || '#/';
  const edit = hash.match(/^#\/listing\/(.+)\/edit$/);
  const view = hash.match(/^#\/listing\/(.+)$/);
  if (hash === '#/new') { S = newState; return renderFlow(); }
  if (edit) return startEdit(edit[1]);
  if (view) return renderListing(view[1]);
  renderHome();
}

window.addEventListener('hashchange', route);
route();
