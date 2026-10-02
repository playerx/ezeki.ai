export const CATEGORIES = ['furniture', 'kitchen', 'electronics', 'clothing', 'books', 'kids', 'garden', 'tools', 'sports', 'decor', 'other'];
export const CONDITIONS = ['like new', 'good', 'fair', 'worn'];
export const MAX_PHOTOS = 3;
export const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
// part key, label, hours shown, start hour, end hour
export const PARTS = [['am', 'Morning', '8–12', 8, 12], ['pm', 'Afternoon', '12–5', 12, 17], ['eve', 'Evening', '5–9', 17, 21]];

// Current time, with a test hook: localStorage 'giveaway.clock' = ISO string
// pins "now" so the walkthrough can move past a pickup window.
export function now() {
  const pinned = localStorage.getItem('giveaway.clock');
  return pinned ? new Date(pinned) : new Date();
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function options(list, selected) {
  return list.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');
}

export function timeAgo(iso) {
  const days = Math.floor((now().getTime() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function slotLabel(slot) {
  const [d, p] = slot.split('-');
  const day = DAYS.find(([k]) => k === d)?.[1] ?? d;
  const part = PARTS.find(([k]) => k === p)?.[1]?.toLowerCase() ?? p;
  return `${day} ${part}`;
}

export function pickupNotesOf(l) {
  return l.pickup?.notes ?? l.pickupNotes ?? '';
}

// `back` is a hash to navigate to, or a function to run (for in-flow steps
// that share a route, where changing the hash would do nothing).
export function layout(title, body, { back, right = '' } = {}) {
  const app = document.querySelector('#app');
  const backLink = typeof back === 'function'
    ? `<a class="back" href="#" id="back-link">&larr; Back</a>`
    : back ? `<a class="back" href="${back}">&larr; Back</a>` : '';
  app.innerHTML = `
    <header class="bar">
      ${backLink}
      <h1>${esc(title)}</h1>
      ${right}
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
