import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

// Secrets live next to the server, never in the Vite project root, so the
// frontend build can't see them. server/.env.development holds the dev key,
// server/.env.production the prod key (both gitignored). A key already in the
// shell environment wins over the file.
const APP_ENV = process.env.NODE_ENV === 'production' ? 'production' : 'development';
try { process.loadEnvFile(new URL(`./.env.${APP_ENV}`, import.meta.url)); } catch {}

const PORT = process.env.PORT || 3001;
const MODEL = 'claude-opus-5';

export const CATEGORIES = [
  'furniture', 'kitchen', 'electronics', 'clothing', 'books', 'kids',
  'garden', 'tools', 'sports', 'decor', 'other',
];
export const CONDITIONS = ['like new', 'good', 'fair', 'worn'];

const DraftSchema = z.object({
  title: z.string(),
  description: z.string(),
  category: z.enum(CATEGORIES),
  condition: z.enum(CONDITIONS),
  pickupHints: z.array(z.string()),
  isPhotoOfItem: z.boolean(),
});

const SYSTEM = `You draft listings for a local free-giveaway marketplace. The giver photographs an item and you write the listing they will edit and post.

Write a short, plain title (under 60 characters) and a two or three sentence description that states what the item is, notable features, and any visible wear or damage. Be honest about condition: a scratch or stain in the photo goes in the description. Do not invent brand names or measurements you cannot see.

isPhotoOfItem is true when the images are photographs of the actual physical item being given away. Set it to false if an image is a drawing, illustration, screenshot, catalog or stock product image, or a photo of a screen or printed page. When false, still fill in the other fields from what is shown, but keep the description to one or two sentences that say what the image appears to be, and return an empty pickupHints array.

pickupHints are short practical notes a recipient needs, inferred from the photo, such as "heavy, bring two people", "bulky, needs a car", or "small, fits in a bag". Return an empty array if nothing is notable.`;

const app = express();
app.use(express.json({ limit: '25mb' }));

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = hasKey ? new Anthropic() : null;

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ai: hasKey });
});

app.post('/api/draft', async (req, res) => {
  const images = Array.isArray(req.body?.images) ? req.body.images : [];
  if (images.length === 0) {
    return res.status(400).json({ error: 'No images provided' });
  }

  if (!client) {
    return res.json({
      stub: true,
      draft: {
        title: '',
        description: '',
        category: 'other',
        condition: 'good',
        pickupHints: [],
        isPhotoOfItem: true,
      },
    });
  }

  try {
    const content = images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data },
    }));
    content.push({ type: 'text', text: 'Draft the listing for this item.' });

    const t0 = Date.now();
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
      output_config: { format: zodOutputFormat(DraftSchema) },
    });

    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      return res.status(502).json({ error: 'The AI could not draft this listing.' });
    }
    const d = response.parsed_output;
    // One line per draft so real-phone tests can be reviewed from the server log. No image data.
    console.log(JSON.stringify({
      draft: { title: d.title, category: d.category, condition: d.condition, isPhotoOfItem: d.isPhotoOfItem, pickupHints: d.pickupHints },
      images: images.length,
      ms: Date.now() - t0,
      tokens: { in: response.usage.input_tokens, out: response.usage.output_tokens },
    }));
    res.json({ stub: false, draft: d });
  } catch (err) {
    console.error(err);
    const status = err instanceof Anthropic.APIError ? err.status : 500;
    res.status(status ?? 500).json({ error: err.message || 'Draft failed' });
  }
});

// Area lookup for the pickup step. Proxies Nominatim (OpenStreetMap) so the
// browser never talks to it directly; results are cached and upstream calls are
// spaced to respect the one-request-per-second usage policy. Only the public
// area is ever geocoded, never the private address.
const geoCache = new Map();
let geoChain = Promise.resolve();
let lastGeoAt = 0;

function shortLabel(r) {
  const a = r.address || {};
  const place = a.city || a.town || a.village || a.hamlet || a.county || '';
  const state = a.state || '';
  const name = r.type === 'postcode' || (a.postcode && r.name === a.postcode)
    ? `${a.postcode || r.name} ${place}`.trim()
    : (r.name || String(r.display_name || '').split(',')[0]);
  const parts = [name];
  if (place && place !== name && !name.endsWith(place)) parts.push(place);
  if (state && state !== place) parts.push(state);
  return parts.join(', ');
}

app.get('/api/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  // Country bias: browser locale region first, else DEFAULT_COUNTRY (set per deployment).
  const cc = (String(req.query.cc || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 2)) || (process.env.DEFAULT_COUNTRY || 'us');
  if (q.length < 2) return res.json([]);
  const key = `${cc}|${q.toLowerCase()}`;
  const hit = geoCache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return res.json(hit.results);

  const job = geoChain.then(async () => {
    const wait = 1100 - (Date.now() - lastGeoAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastGeoAt = Date.now();
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.search = new URLSearchParams({ format: 'jsonv2', q, limit: '5', addressdetails: '1', ...(cc ? { countrycodes: cc } : {}) }).toString();
    const r = await fetch(url, { headers: { 'User-Agent': 'giveaway-mvp/0.1 (local dev)', 'Accept-Language': req.get('accept-language') || 'en' } });
    if (!r.ok) throw new Error(`geocoder responded ${r.status}`);
    const rows = await r.json();
    const seen = new Set();
    const results = rows
      .map((x) => ({ label: shortLabel(x), lat: Number(x.lat), lon: Number(x.lon) }))
      .filter((x) => !seen.has(x.label) && seen.add(x.label))
      .slice(0, 4);
    geoCache.set(key, { at: Date.now(), results });
    return results;
  });
  geoChain = job.catch(() => {});
  try {
    res.json(await job);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not look up that area right now' });
  }
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT} (env: ${APP_ENV}, ai: ${hasKey ? 'on' : 'off, no key set'})`);
});
