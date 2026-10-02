const KEY = 'giveaway.listings';

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

export function newListing(fields) {
  return {
    id: crypto.randomUUID(),
    photos: [],
    title: '',
    description: '',
    category: 'other',
    condition: 'good',
    pickupNotes: '',
    price: null, // null = free; paid listings are not in the MVP
    status: 'listed', // listed | requested | accepted | completed | cancelled
    createdAt: new Date().toISOString(),
    ...fields,
  };
}
