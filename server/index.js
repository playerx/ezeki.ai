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

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT} (env: ${APP_ENV}, ai: ${hasKey ? 'on' : 'off, no key set'})`);
});
