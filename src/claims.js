// Claim loop, pure functions over a listing object. First come, first served:
// claiming means picking a concrete pickup window from the giver's
// availability. The first claim is accepted automatically and gets the
// address; later claims queue as a waitlist and move up on cancel or no-show.
import { DAYS, PARTS, now } from './util.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const NO_ANSWER_GRACE_MS = 24 * 3600 * 1000;

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function part(key) { return PARTS.find(([k]) => k === key); }

export function windowStart({ date, part: pk }) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, part(pk)[3], 0, 0, 0);
}

export function windowEnd({ date, part: pk }) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, part(pk)[4], 0, 0, 0);
}

export function windowLabel(when) {
  const s = windowStart(when);
  const day = s.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const p = part(when.part);
  return `${day}, ${p[1].toLowerCase()} ${p[2]}`;
}

// Concrete windows in the next `days` days that match the giver's weekly
// availability and haven't ended yet.
export function upcomingWindows(availability, days = 7, from = now()) {
  const out = [];
  for (let i = 0; i <= days; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const dk = DAY_KEYS[d.getDay()];
    for (const [pk] of PARTS) {
      if (!availability.includes(`${dk}-${pk}`)) continue;
      const when = { date: ymd(d), part: pk };
      if (windowEnd(when) <= from) continue;
      out.push({ ...when, label: windowLabel(when), slot: `${dk}-${pk}` });
    }
  }
  return out;
}

export function activeClaim(l) {
  return (l.requests || []).find((r) => r.status === 'accepted') || null;
}

export function waitlist(l) {
  return (l.requests || []).filter((r) => r.status === 'waiting');
}

export function myRequest(l, meId) {
  return (l.requests || []).find((r) => r.meId === meId && ['accepted', 'waiting'].includes(r.status)) || null;
}

export function isOpen(l) {
  return ['listed', 'claimed'].includes(l.status);
}

// Promote the next waiting request, or put the item back on the board.
function promote(l) {
  const next = waitlist(l)[0];
  if (next) {
    next.status = 'accepted';
    next.acceptedAt = now().toISOString();
    l.status = 'claimed';
  } else {
    l.status = 'listed';
  }
  return l;
}

export function claim(l, { meId, name, message, when }) {
  const copy = structuredClone(l);
  copy.requests ||= [];
  if (myRequest(copy, meId)) return copy;
  const r = { id: crypto.randomUUID(), meId, name, message, when, status: 'waiting', createdAt: now().toISOString() };
  copy.requests.push(r);
  if (!activeClaim(copy) && copy.status === 'listed') {
    r.status = 'accepted';
    r.acceptedAt = r.createdAt;
    copy.status = 'claimed';
  }
  return copy;
}

export function cancel(l, requestId, by) {
  const copy = structuredClone(l);
  const r = (copy.requests || []).find((x) => x.id === requestId);
  if (!r || !['accepted', 'waiting'].includes(r.status)) return copy;
  const wasActive = r.status === 'accepted';
  r.status = 'cancelled';
  r.cancelledBy = by;
  r.cancelledAt = now().toISOString();
  if (wasActive) promote(copy);
  return copy;
}

// Either side answers "did it happen?" after the window. A yes closes it (the
// item is gone either way). A no records a no-show against the other side
// and reopens the listing for the next in line.
export function checkin(l, requestId, who, happened) {
  const copy = structuredClone(l);
  const r = (copy.requests || []).find((x) => x.id === requestId);
  if (!r || r.status !== 'accepted') return copy;
  r.checkin = { ...(r.checkin || {}), [who]: happened };
  if (!happened) {
    r.status = 'no_show';
    r.noShowBy = who === 'giver' ? 'recipient' : 'giver';
    promote(copy);
  } else {
    r.status = 'completed';
    copy.status = 'completed';
    copy.completedAt = now().toISOString();
  }
  return copy;
}

export function pickupDue(l, at = now()) {
  const r = activeClaim(l);
  return r && windowEnd(r.when) <= at ? r : null;
}

export function pickupToday(l, at = now()) {
  const r = activeClaim(l);
  return r && r.when.date === ymd(at) && windowEnd(r.when) > at ? r : null;
}

// A day after the window with no answer from both sides: treat as no-show by
// nobody in particular and move on. Returns a new listing or null if unchanged.
export function settleOverdue(l, at = now()) {
  const r = activeClaim(l);
  if (!r) return null;
  if (windowEnd(r.when).getTime() + NO_ANSWER_GRACE_MS > at.getTime()) return null;
  const copy = structuredClone(l);
  const rr = copy.requests.find((x) => x.id === r.id);
  rr.status = 'no_show';
  rr.noShowBy = 'unknown';
  promote(copy);
  return copy;
}
