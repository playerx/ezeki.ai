import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Rough-area map: a circle around the geocoded area centroid. The circle is
// deliberately wide and is never derived from the street address.
const AREA_RADIUS_M = 600;

export function renderAreaMap(el, { lat, lon }) {
  if (!el) return null;
  const map = L.map(el, {
    zoomControl: false, dragging: false, scrollWheelZoom: false, touchZoom: false,
    doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false,
  });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  L.circle([lat, lon], { radius: AREA_RADIUS_M, color: '#1f6f4a', fillColor: '#1f6f4a', fillOpacity: 0.15, weight: 2 }).addTo(map);
  map.setView([lat, lon], 14);
  setTimeout(() => map.invalidateSize(), 0);
  return map;
}

export function osmLink({ lat, lon }) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`;
}

// Country bias from the browser locale (en-US -> us) so a bare postcode finds
// the local one instead of matches on three continents.
export async function geocode(q) {
  const cc = (navigator.language.split('-')[1] || '').toLowerCase();
  try {
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}&cc=${encodeURIComponent(cc)}`);
    if (!r.ok) return [];
    return await r.json();
  } catch {
    return [];
  }
}
