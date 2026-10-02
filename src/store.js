const KEY = 'giveaway.listings';
const GIVER_KEY = 'giveaway.giver';

export class StorageFullError extends Error {
  constructor() {
    super("This phone's storage for the app is full. Delete an old listing or use fewer photos.");
    this.name = 'StorageFullError';
  }
}

function isQuotaError(e) {
  return e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
}

export function loadListings() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveListing(listing) {
  const all = loadListings();
  const idx = all.findIndex((l) => l.id === listing.id);
  if (idx >= 0) all[idx] = listing;
  else all.unshift(listing);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (e) {
    if (isQuotaError(e)) throw new StorageFullError();
    throw e;
  }
  return listing;
}

export function getListing(id) {
  return loadListings().find((l) => l.id === id) || null;
}

export function deleteListing(id) {
  const all = loadListings().filter((l) => l.id !== id);
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function newListing(fields) {
  return {
    id: crypto.randomUUID(),
    photos: [],
    title: '',
    description: '',
    category: 'other',
    condition: 'good',
    pickup: null, // { area, address, availability: ['mon-eve', ...], notes }; address is private
    price: null, // null = free; paid listings are not in the MVP
    status: 'listed', // listed | requested | accepted | completed | cancelled
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

// Giver defaults: area, address and availability remembered from the last
// listing so the Pickup step is prefilled next time.
export function loadGiverDefaults() {
  try {
    return JSON.parse(localStorage.getItem(GIVER_KEY)) || null;
  } catch {
    return null;
  }
}

export function saveGiverDefaults(defaults) {
  try {
    localStorage.setItem(GIVER_KEY, JSON.stringify(defaults));
  } catch {
    // Defaults are a convenience; never block posting on them.
  }
}

// In-progress listing drafts, so a refresh or a detour to another screen
// doesn't lose work. Best effort: if the draft is too big to store we carry
// on in memory rather than block the user.
export function loadDraft(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || null;
  } catch {
    return null;
  }
}

export function saveDraft(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // quota or private mode; keep going in memory
  }
}

export function clearDraft(key) {
  localStorage.removeItem(key);
}
