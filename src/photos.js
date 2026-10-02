// Two sizes: a larger copy goes to the AI for drafting, a smaller copy is what
// we keep in the browser so a handful of listings doesn't blow the storage quota.
const DRAFT = { maxEdge: 1280, quality: 0.82 };
const STORE = { maxEdge: 900, quality: 0.72 };

function resize(bitmap, { maxEdge, quality }) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function fileToDataUrl(file) {
  return resize(await createImageBitmap(file), DRAFT);
}

export async function shrinkForStorage(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return resize(await createImageBitmap(blob), STORE);
}

export function dataUrlToApiImage(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const mediaType = header.match(/data:(.*?);/)[1];
  return { mediaType, data };
}
