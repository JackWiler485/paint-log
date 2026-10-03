// Progress photos: shrinking photos before saving, small preview copies
// (thumbnails), and reading the date a photo was taken.

const PHOTO_LONG_EDGE = 1280; // pixels on the longest side of a saved photo
const PHOTO_QUALITY = 0.85; // JPEG quality, 0 to 1
const THUMB_LONG_EDGE = 320;
const THUMB_QUALITY = 0.75;

// Load an image file so it can be drawn. The browser turns the photo the
// right way up (phones store some photos sideways with a "rotate" note).
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This file could not be read as a picture.'));
    };
    img.src = url;
  });
}

// Draw the image at a smaller size and save it as a JPEG.
function shrinkImage(img, longEdge, quality) {
  const scale = Math.min(1, longEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      // Free the canvas memory straight away (iPhones have a strict limit).
      canvas.width = 0;
      canvas.height = 0;
      if (blob) {
        resolve({ blob, width, height });
      } else {
        reject(new Error('The picture could not be saved.'));
      }
    }, 'image/jpeg', quality);
  });
}

// Turn a picked file into what is saved: the photo, a thumbnail and its date.
async function preparePhoto(file) {
  const takenAt = (await readPhotoDate(file)) || Date.now();
  const img = await loadImage(file);
  const photo = await shrinkImage(img, PHOTO_LONG_EDGE, PHOTO_QUALITY);
  const thumb = await shrinkImage(img, THUMB_LONG_EDGE, THUMB_QUALITY);
  return { blob: photo.blob, width: photo.width, height: photo.height, thumb: thumb.blob, takenAt };
}

// ---------- The date a photo was taken ----------
// JPEG photos usually carry "EXIF" details, including when they were taken.
// This reads just that date. Anything unexpected simply gives no date.

async function readPhotoDate(file) {
  try {
    const view = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (view.getUint16(0) !== 0xFFD8) {
      return null; // not a JPEG
    }
    let offset = 2;
    while (offset + 10 < view.byteLength) {
      const marker = view.getUint16(offset);
      if ((marker & 0xFF00) !== 0xFF00) {
        return null;
      }
      const size = view.getUint16(offset + 2);
      if (marker === 0xFFE1 && view.getUint32(offset + 4) === 0x45786966) { // "Exif"
        return exifDate(view, offset + 10);
      }
      offset += 2 + size;
    }
  } catch (err) {
    // Unreadable details: fall back to today.
  }
  return null;
}

function exifDate(view, start) {
  const little = view.getUint16(start) === 0x4949; // "II" = little-endian
  const u16 = (at) => view.getUint16(start + at, little);
  const u32 = (at) => view.getUint32(start + at, little);

  function readEntries(at) {
    const entries = {};
    const count = u16(at);
    for (let i = 0; i < count; i++) {
      const entry = at + 2 + i * 12;
      entries[u16(entry)] = { count: u32(entry + 4), value: u32(entry + 8) };
    }
    return entries;
  }

  function readText(entry) {
    let text = '';
    for (let i = 0; i < entry.count - 1; i++) {
      text += String.fromCharCode(view.getUint8(start + entry.value + i));
    }
    return text;
  }

  const main = readEntries(u32(4));
  let text = null;
  if (main[0x8769]) {
    const details = readEntries(main[0x8769].value);
    if (details[0x9003]) {
      text = readText(details[0x9003]); // date taken
    }
  }
  if (!text && main[0x0132]) {
    text = readText(main[0x0132]); // date changed
  }
  const parts = text && text.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!parts) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  const time = new Date(year, month - 1, day, hour, minute, second).getTime();
  const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
  return year >= 1990 && time <= tomorrow ? time : null;
}

// ---------- Showing photos ----------
// Saved pictures are shown through temporary web addresses ("object URLs").
// Each screen part keeps its own group, released when it is drawn again,
// so old pictures don't pile up in memory.

const objectUrlGroups = {};

function newUrlGroup(group) {
  for (const url of objectUrlGroups[group] || []) {
    URL.revokeObjectURL(url);
  }
  objectUrlGroups[group] = [];
  return (blob) => {
    const url = URL.createObjectURL(blob);
    objectUrlGroups[group].push(url);
    return url;
  };
}

// "3 Oct 2026" for a time; "2026-10-03" for a date field.
function dateFieldValue(time) {
  const d = new Date(time);
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// A new date from a date field, keeping the original time of day.
function withDate(time, fieldValue) {
  const [year, month, day] = fieldValue.split('-').map(Number);
  const d = new Date(time);
  return new Date(year, month - 1, day, d.getHours(), d.getMinutes(), d.getSeconds()).getTime();
}
