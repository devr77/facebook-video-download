// Pulls downloadable video links out of Facebook page HTML, in the browser, for the
// private video tool (page source is never uploaded). Link-based downloads use the
// TypeScript twin in saas-backend (src/lib/facebook.ts); keep the patterns in sync.

const HD_PATTERNS = [
  /"browser_native_hd_url":"([^"]+)"/,
  /"playable_url_quality_hd":"([^"]+)"/,
  /"hd_src(?:_no_ratelimit)?":"([^"]+)"/,
  /hd_src(?:_no_ratelimit)?:"([^"]+)"/,
];

const SD_PATTERNS = [
  /"browser_native_sd_url":"([^"]+)"/,
  /"playable_url":"([^"]+)"/,
  /"sd_src(?:_no_ratelimit)?":"([^"]+)"/,
  /sd_src(?:_no_ratelimit)?:"([^"]+)"/,
];

// Newer markup: "progressive_url":"...","failure_reason":null,"metadata":{"quality":"HD"}
const PROGRESSIVE = /"progressive_url":"([^"]+)","failure_reason":null,"metadata":\{"quality":"(HD|SD)"\}/g;

const OG_VIDEO = /<meta[^>]+property="og:video(?::secure_url|:url)?"[^>]+content="([^"]+)"/i;
const OG_TITLE = /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i;
const OG_IMAGE = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i;
const TITLE_TAG = /<title[^>]*>([^<]*)<\/title>/i;
const JSON_THUMB = /"preferred_thumbnail":\{"image":\{"uri":"([^"]+)"/;

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replace(/\\\//g, '/');
  }
}

const NAMED_ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };

function decodeEntities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, code) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return point === 0xa0 ? ' ' : String.fromCodePoint(point);
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
  });
}

// "2.8M views · 1.2K reactions | Actual title | Facebook" -> "Actual title"
function cleanTitle(raw) {
  let title = decodeEntities(raw).replace(/\s*\|\s*Facebook\s*$/i, '').trim();
  const parts = title.split(' | ');
  if (parts.length > 1 && parts[0].includes('·')) title = parts.slice(1).join(' | ');
  return title;
}

function firstMatch(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeJsonString(match[1]);
  }
  return null;
}

function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * @param {string} html Raw Facebook page HTML / page source.
 * @returns {{ title: string, thumbnail: string | null, links: { quality: 'HD' | 'SD', url: string }[] }}
 */
export function extractVideo(html) {
  const found = { HD: firstMatch(html, HD_PATTERNS), SD: firstMatch(html, SD_PATTERNS) };

  for (const [, url, quality] of html.matchAll(PROGRESSIVE)) {
    found[quality] ??= decodeJsonString(url);
  }

  if (!found.HD && !found.SD) {
    const og = html.match(OG_VIDEO);
    if (og) found.SD = decodeEntities(og[1]);
  }

  const links = [];
  const seen = new Set();
  for (const quality of ['HD', 'SD']) {
    const url = found[quality];
    if (url && isHttpUrl(url) && !seen.has(url)) {
      seen.add(url);
      links.push({ quality, url });
    }
  }

  const rawTitle = html.match(OG_TITLE)?.[1] ?? html.match(TITLE_TAG)?.[1] ?? '';
  const title = cleanTitle(rawTitle) || 'Facebook video';

  const ogImage = html.match(OG_IMAGE)?.[1];
  const jsonThumb = html.match(JSON_THUMB)?.[1];
  const thumbnail = ogImage ? decodeEntities(ogImage) : jsonThumb ? decodeJsonString(jsonThumb) : null;

  return { title, thumbnail, links };
}

const FACEBOOK_HOST = /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/i;

export function isFacebookUrl(value) {
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'https:' || url.protocol === 'http:') && FACEBOOK_HOST.test(url.hostname);
  } catch {
    return false;
  }
}
