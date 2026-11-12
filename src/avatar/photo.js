// Profile picture: a raver's photo shown as a circle on the front of their avatar's head.
// Uploads are cropped to a centred square and shrunk to a small data URL in the browser, so
// what's stored and sent to everyone is a ~10 KB image — never the original file.

export const PHOTO_SIZE = 160; // px, square
export const PHOTO_MAX_CHARS = 60000; // data-URL length cap (the server enforces the same)
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const PHOTO_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

/** True for a data URL we're willing to load (an inline jpeg/png/webp under the size cap). */
export function isPhotoUrl(v) {
  return typeof v === 'string' && v.length <= PHOTO_MAX_CHARS && PHOTO_URL.test(v);
}

async function decode(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to <img> (e.g. older Safari) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Turn an uploaded image file into a small square data URL.
 * Throws an Error with a friendly message when the file isn't usable.
 */
export async function processPhoto(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('That file isn’t an image.');
  if (file.size > MAX_FILE_BYTES) throw new Error('That image is too big (max 20 MB).');
  let img;
  try {
    img = await decode(file);
  } catch {
    throw new Error('Couldn’t read that image — try a JPG or PNG.');
  }
  const w = img.width;
  const h = img.height;
  if (!w || !h) throw new Error('Couldn’t read that image — try a JPG or PNG.');
  const side = Math.min(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PHOTO_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  img.close?.();
  // WebP where supported, JPEG otherwise; step the quality down until it fits.
  for (const [type, q] of [['image/webp', 0.85], ['image/jpeg', 0.85], ['image/webp', 0.6], ['image/jpeg', 0.6]]) {
    const url = canvas.toDataURL(type, q);
    if (url.startsWith(`data:${type}`) && isPhotoUrl(url)) return url;
  }
  throw new Error('Couldn’t shrink that image enough — try another one.');
}
