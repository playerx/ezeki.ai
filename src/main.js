import './style.css';
import { loadListings, saveListing, deleteListing } from './store.js';
import { renderAreaMap, osmLink } from './map.js';
import { esc, timeAgo, slotLabel, pickupNotesOf, layout } from './util.js';
import { startNew, startEdit, discardNewDraft, forgetEditDraft, hasUnfinishedListing } from './flow.js';
import {
  upcomingWindows, windowLabel, activeClaim, waitlist, myRequest, isOpen,
  claim, cancel, checkin, pickupDue, pickupToday, settleOverdue,
} from './claims.js';

// ---------- Who is looking ----------
// No accounts yet. A persona switch lets one phone play both sides: the giver
// who posted, and a finder browsing. A finder gets a random id and a name.
const PERSONA_KEY = 'giveaway.persona';
const ME_KEY = 'giveaway.me';

function persona() { return localStorage.getItem(PERSONA_KEY) === 'finder' ? 'finder' : 'giver'; }
function setPersona(p) { localStorage.setItem(PERSONA_KEY, p); }
function me() {
  try {
    const m = JSON.parse(localStorage.getItem(ME_KEY));
    if (m?.id) return m;
  } catch { /* fall through */ }
  const m = { id: crypto.randomUUID(), name: '' };
  localStorage.setItem(ME_KEY, JSON.stringify(m));
  return m;
}
function saveMe(m) { localStorage.setItem(ME_KEY, JSON.stringify(m)); }

function personaSwitch() {
  const p = persona();
  return `<div class="seg" role="group" aria-label="Mode">
    <button type="button" data-p="giver" aria-pressed="${p === 'giver'}">Giving</button>
    <button type="button" data-p="finder" aria-pressed="${p === 'finder'}">Finding</button>
  </div>`;
}
function wirePersonaSwitch(rerender) {
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { setPersona(b.dataset.p); rerender(); }));
}

// Settle anything overdue before rendering: a day after a pickup window with
// no answer, the claim lapses and the next in line gets it.
function freshListings() {
  return loadListings().map((l) => {
    const settled = settleOverdue(l);
    if (settled) saveListing(settled);
    return settled || l;
  });
}
function freshListing(id) { return freshListings().find((l) => l.id === id) || null; }

function statusBadge(l) {
  const cls = l.status === 'listed' ? '' : l.status === 'claimed' ? ' warn' : ' done';
  return `<span class="badge${cls}">${esc(l.status)}</span>`;
}

// ---------- Home ----------
function renderHome() {
  const p = persona();
  const listings = freshListings();
  const visible = p === 'finder' ? listings.filter(isOpen) : listings;
  const rows = visible.length
    ? visible.map((l) => {
        const mine = p === 'finder' ? myRequest(l, me().id) : null;
        const note = mine ? (mine.status === 'accepted' ? 'yours to pick up' : "you're in line") : '';
        return `
        <a class="listing-row" href="#/listing/${l.id}">
          <img src="${l.photos[0] || ''}" alt="" />
          <div>
            <div class="title">${esc(l.title || 'Untitled')}</div>
            <div class="meta">Free &middot; ${esc(l.condition)}${l.pickup?.area ? ' &middot; ' + esc(l.pickup.area) : ''} &middot; ${statusBadge(l)}${note ? ' &middot; ' + note : ''}</div>
          </div>
        </a>`;
      }).join('<hr class="row-sep">')
    : `<div class="empty">${p === 'finder' ? 'Nothing free nearby right now.' : 'Nothing listed yet.<br>Give something away to get started.'}</div>`;

  const banners = [];
  if (p === 'giver' && hasUnfinishedListing()) {
    banners.push(`<div class="banner" id="resume-banner"><span>You have an unfinished listing.</span><a href="#/new">Resume</a><button type="button" id="discard-draft">Discard</button></div>`);
  }
  for (const l of listings) {
    const r = activeClaim(l);
    if (!r) continue;
    if (p === 'finder' && r.meId !== me().id) continue;
    if (pickupDue(l)) banners.push(`<div class="banner"><span>Did the pickup of <strong>${esc(l.title)}</strong> happen?</span><a href="#/listing/${l.id}">Check in</a></div>`);
    else if (pickupToday(l)) banners.push(`<div class="banner"><span>Pickup today: <strong>${esc(l.title)}</strong>, ${esc(windowLabel(r.when))}</span><a href="#/listing/${l.id}">Details</a></div>`);
  }

  layout(p === 'finder' ? 'Free nearby' : 'Giveaway', `
    ${banners.join('')}
    ${p === 'giver' ? `<a class="btn primary" href="#/new">Give something away</a>` : `<p class="muted">Tap an item to claim a pickup time.</p>`}
    <div class="card">${rows}</div>
  `, { right: personaSwitch() });
  wirePersonaSwitch(renderHome);
  document.querySelector('#discard-draft')?.addEventListener('click', () => { discardNewDraft(); renderHome(); });
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

function giverSection(l) {
  const r = activeClaim(l);
  const q = waitlist(l);
  let main = '';
  if (r) {
    const due = pickupDue(l);
    main = `<div class="claim-card">
      <h3>${due ? 'Did the pickup happen?' : 'Claimed'}</h3>
      <div><strong>${esc(r.name || 'Someone')}</strong> &middot; ${esc(windowLabel(r.when))}</div>
      ${r.message ? `<div>&ldquo;${esc(r.message)}&rdquo;</div>` : ''}
      ${due
        ? `<div class="actions-row"><button class="btn primary" id="ci-yes">Yes, it's gone</button><button class="btn" id="ci-no">No-show</button></div>`
        : `<div class="hint">They can see your address and pickup notes.</div><button class="btn" id="cancel-pickup">Cancel this pickup</button>`}
    </div>`;
  } else if (l.status === 'listed') {
    main = `<div class="claim-card muted"><h3>No one has claimed it yet.</h3><div class="hint">The first person to pick a time gets it.</div></div>`;
  } else if (l.status === 'completed') {
    main = `<div class="claim-card muted"><h3>Given away.</h3></div>`;
  }
  const queue = q.length
    ? `<div class="claim-card muted"><h3>Waitlist (${q.length})</h3><ol class="queue">${q.map((x) => `<li>${esc(x.name || 'Someone')} &middot; ${esc(windowLabel(x.when))}</li>`).join('')}</ol><div class="hint">Next in line gets it automatically if this pickup falls through.</div></div>`
    : '';
  return `${main}${queue}
    <div class="actions-row"><a class="btn" href="#/listing/${l.id}/edit">Edit listing</a><button class="btn danger" id="delete-btn">Remove</button></div>`;
}

function finderSection(l) {
  const m = me();
  const mine = myRequest(l, m.id);
  const notes = pickupNotesOf(l);
  if (mine?.status === 'accepted') {
    const due = pickupDue(l);
    return `<div class="claim-card" id="my-claim">
      <h3>${due ? 'Did you pick it up?' : "It's yours"}</h3>
      <div>${esc(windowLabel(mine.when))}</div>
      <div class="addr">${esc(l.pickup?.address || '')}</div>
      ${notes ? `<div class="notes">${esc(notes)}</div>` : ''}
      <a class="map-link" href="https://maps.google.com/?q=${encodeURIComponent(l.pickup?.address || '')}" target="_blank" rel="noopener">Open address in Maps</a>
      ${due
        ? `<div class="actions-row"><button class="btn primary" id="ci-yes">Yes, got it</button><button class="btn" id="ci-no">No, it fell through</button></div>`
        : `<button class="btn" id="cancel-pickup">Cancel my pickup</button>`}
    </div>`;
  }
  if (mine?.status === 'waiting') {
    const pos = waitlist(l).findIndex((x) => x.id === mine.id) + 1;
    return `<div class="claim-card muted" id="my-claim">
      <h3>You're #${pos} in line</h3>
      <div>Your pick: ${esc(windowLabel(mine.when))}</div>
      <div class="hint">If the current pickup falls through, it's yours and the address appears here.</div>
      <button class="btn" id="cancel-pickup">Leave the line</button>
    </div>`;
  }
  if (!isOpen(l)) return `<div class="claim-card muted"><h3>This one's gone.</h3></div>`;
  const windows = upcomingWindows(l.pickup?.availability || []);
  if (!windows.length) return `<div class="claim-card muted"><h3>No pickup times in the next week.</h3></div>`;
  const claimed = l.status === 'claimed';
  return `<form class="claim-card muted" id="claim-form">
    <h3>${claimed ? 'Already claimed. Join the waitlist?' : 'Claim it: pick a pickup time'}</h3>
    <div class="hint">${claimed ? 'If the first pickup falls through, the next in line gets it.' : 'First to pick a time gets it. The address is shown once you confirm.'}</div>
    <div class="field"><label for="c-name">Your name</label><input id="c-name" required maxlength="40" value="${esc(m.name)}" /></div>
    <div class="field"><label>When can you come?</label><div class="windows">${windows.map((w, i) => `<button type="button" data-i="${i}" aria-pressed="false">${esc(w.label)}</button>`).join('')}</div></div>
    <div class="field"><label for="c-msg">Message <span class="small">(optional, one line)</span></label><input id="c-msg" maxlength="140" placeholder="I can carry it, I have a car…" /></div>
    <div class="notice error" id="claim-error" hidden>Pick a time first.</div>
    <button class="btn primary" type="submit">${claimed ? 'Join waitlist' : 'Confirm pickup'}</button>
  </form>`;
}

function renderListing(id) {
  const l = freshListing(id);
  if (!l) return layout('Not found', `<div class="empty">That listing doesn't exist.</div>`, { back: '#/' });
  const p = persona();
  const rerender = () => renderListing(id);
  const update = (next) => { saveListing(next); rerender(); };

  layout('Listing', `
    <div class="card">
      <img class="hero" src="${l.photos[0] || ''}" alt="" />
      ${l.photos.length > 1 ? `<div class="thumbs">${l.photos.map((x) => `<img src="${x}" alt="" />`).join('')}</div>` : ''}
      <div class="detail">
        <div class="price">Free</div>
        <h2>${esc(l.title)}</h2>
        <div class="kv">${statusBadge(l)}<span>${esc(l.category)}</span><span>&middot;</span><span>${esc(l.condition)}</span><span>&middot;</span><span>posted ${timeAgo(l.createdAt)}</span></div>
        <p>${esc(l.description)}</p>
        ${pickupBlock(l)}
      </div>
    </div>
    ${p === 'finder' ? finderSection(l) : giverSection(l)}
    <a class="btn ghost" href="#/">Done</a>
  `, { back: '#/', right: personaSwitch() });

  wirePersonaSwitch(rerender);
  if (l.pickup?.location) renderAreaMap(document.querySelector('#listing-map'), l.pickup.location);

  // Giver actions
  document.querySelector('#delete-btn')?.addEventListener('click', () => {
    if (!confirm('Remove this listing? This cannot be undone.')) return;
    deleteListing(l.id);
    forgetEditDraft(l.id);
    location.hash = '#/';
  });

  // Shared actions: cancel and check-in act on the active claim (giver) or my claim (finder)
  const who = p === 'finder' ? 'recipient' : 'giver';
  const target = p === 'finder' ? myRequest(l, me().id) : activeClaim(l);
  document.querySelector('#cancel-pickup')?.addEventListener('click', () => {
    if (!target) return;
    const msg = p === 'finder' ? 'Cancel your pickup? The next person in line gets it.' : 'Cancel this pickup? The next person in line gets it, or the item goes back on the board.';
    if (!confirm(msg)) return;
    update(cancel(l, target.id, who));
  });
  document.querySelector('#ci-yes')?.addEventListener('click', () => target && update(checkin(l, target.id, who, true)));
  document.querySelector('#ci-no')?.addEventListener('click', () => target && update(checkin(l, target.id, who, false)));

  // Finder: claim or join the waitlist
  const form = document.querySelector('#claim-form');
  if (form) {
    const windows = upcomingWindows(l.pickup?.availability || []);
    let picked = -1;
    form.querySelectorAll('.windows button').forEach((b) => b.addEventListener('click', () => {
      picked = Number(b.dataset.i);
      form.querySelectorAll('.windows button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      document.querySelector('#claim-error').hidden = true;
    }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (picked < 0) { document.querySelector('#claim-error').hidden = false; return; }
      const m = me();
      const name = document.querySelector('#c-name').value.trim();
      saveMe({ ...m, name });
      const { date, part } = windows[picked];
      update(claim(l, { meId: m.id, name, message: document.querySelector('#c-msg').value.trim(), when: { date, part } }));
    });
  }
}

// ---------- Router ----------
function route() {
  const hash = location.hash || '#/';
  const edit = hash.match(/^#\/listing\/(.+)\/edit$/);
  const view = hash.match(/^#\/listing\/(.+)$/);
  if (hash === '#/new') return startNew();
  if (edit) return startEdit(edit[1]);
  if (view) return renderListing(view[1]);
  renderHome();
}

window.addEventListener('hashchange', route);
route();
