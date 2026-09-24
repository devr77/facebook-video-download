import { extractVideo, isFacebookUrl } from './extract.js';

const ICON_DOWNLOAD =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

initNav();
document.querySelectorAll('form[data-tool]').forEach(initTool);

// Mixpanel is loaded and initialized by the build (scripts/build.mjs); calls queue until the SDK arrives.
function track(event, properties) {
  try {
    window.mixpanel?.track(event, properties);
  } catch {
    // Analytics must never break the tool.
  }
}

function initNav() {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    nav.classList.toggle('is-open', open);
  });
}

function initTool(form) {
  const api = form.dataset.api;
  const status = form.querySelector('.tool-status');
  const result = form.querySelector('.result');
  const mode = form.dataset.tool;

  const ui = {
    loading(on) {
      form.classList.toggle('is-loading', on);
      form.setAttribute('aria-busy', String(on));
    },
    error(html) {
      status.innerHTML = html;
      result.hidden = true;
    },
    clear() {
      status.textContent = '';
      result.hidden = true;
      result.replaceChildren();
    },
  };

  const pasteBtn = form.querySelector('[data-paste]');
  if (pasteBtn) {
    if (!navigator.clipboard?.readText) pasteBtn.hidden = true;
    pasteBtn.addEventListener('click', async () => {
      try {
        form.elements.url.value = (await navigator.clipboard.readText()).trim();
        form.elements.url.focus();
      } catch {
        form.elements.url.focus();
      }
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    ui.clear();
    try {
      ui.loading(true);
      const video = mode === 'source' ? fromSource(form.elements.source.value) : await fromUrl(api, form.elements.url.value);
      renderResult(result, video, api, mode);
      track('video_extracted', {
        source_mode: mode,
        link_count: video.links.length,
        has_hd: video.links.some((l) => l.quality === 'HD'),
      });
    } catch (err) {
      track('video_extract_failed', {
        source_mode: mode,
        error_type: err.errorType || 'network_error',
        ...(err.status && { status_code: err.status }),
      });
      ui.error(err.userMessage || 'Could not reach the server. Check your connection and try again.');
    } finally {
      ui.loading(false);
    }
  });

  // Allow deep links like /?url=https://www.facebook.com/... (share targets, bookmarklets).
  if (mode === 'url') {
    const shared = new URLSearchParams(location.search).get('url');
    if (shared && isFacebookUrl(shared)) {
      form.elements.url.value = shared;
      form.requestSubmit();
    }
  }
}

function userError(message, errorType = 'invalid_input', status) {
  const err = new Error(message);
  err.userMessage = message;
  err.errorType = errorType;
  if (status) err.status = status;
  return err;
}

async function fromUrl(api, rawUrl) {
  const url = rawUrl.trim();
  if (!url) throw userError('Please paste a Facebook video link first.');
  if (!isFacebookUrl(url)) throw userError('That doesn\'t look like a Facebook link. It should start with https://www.facebook.com/ or https://fb.watch/');

  // Backend envelope: `{ data }` on success, `{ error: { code, message } }` on failure.
  const res = await fetch(`${api}/v1/downloader/extract?url=${encodeURIComponent(url)}`, { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const base = document.querySelector('.brand')?.getAttribute('href') || '/';
    const message =
      res.status === 429 ? 'Too many requests. Please wait a minute and try again.' : body.error?.message;
    throw userError(
      escapeHtml(message || 'Something went wrong. Please try again.') +
        (res.status === 404 ? ` <a href="${base}private-video-downloader/">Try the private video downloader →</a>` : ''),
      res.status === 404 ? 'not_found' : res.status === 429 ? 'rate_limited' : 'api_error',
      res.status,
    );
  }
  return body.data;
}

function fromSource(source) {
  if (source.trim().length < 200) throw userError('Please paste the full page source of the Facebook video page.');
  const video = extractVideo(source);
  if (!video.links.length) {
    throw userError('No video found in that page source. Open the video page itself, let it start playing, then copy the full source again.', 'not_found');
  }
  return video;
}

function renderResult(container, video, api, mode) {
  const fragment = document.createDocumentFragment();

  // Preview the lightest available stream; poster is optional since Facebook often omits og:image.
  const preview = video.links.find((l) => l.quality === 'SD') || video.links[0];
  const thumb = document.createElement('video');
  thumb.className = 'result-thumb';
  thumb.controls = true;
  thumb.playsInline = true;
  thumb.preload = 'metadata';
  if (video.thumbnail) thumb.poster = video.thumbnail;
  thumb.src = preview.url;

  const body = document.createElement('div');
  const title = document.createElement('h2');
  title.className = 'result-title';
  title.textContent = video.title;

  const actions = document.createElement('div');
  actions.className = 'result-actions';
  for (const link of video.links) {
    const a = document.createElement('a');
    a.className = `btn ${link.quality === 'HD' ? 'btn-success' : 'btn-primary'}`;
    a.href = `${api}/v1/downloader/download?url=${encodeURIComponent(link.url)}&name=${encodeURIComponent(video.title)}`;
    a.rel = 'nofollow';
    a.innerHTML = `${ICON_DOWNLOAD}<span>Download ${link.quality}</span>`;
    a.addEventListener('click', () => track('video_download_clicked', { quality: link.quality.toLowerCase(), download_method: 'direct', source_mode: mode }));
    actions.append(a);
  }
  const open = document.createElement('a');
  open.className = 'btn btn-ghost';
  open.href = video.links[0].url;
  open.target = '_blank';
  open.rel = 'noreferrer nofollow';
  open.textContent = 'Open in new tab';
  open.addEventListener('click', () =>
    track('video_download_clicked', { quality: video.links[0].quality.toLowerCase(), download_method: 'new_tab', source_mode: mode }),
  );
  actions.append(open);

  const note = document.createElement('p');
  note.className = 'result-note';
  note.textContent = video.links.some((l) => l.quality === 'HD')
    ? 'Tip: if the download doesn\'t start, use "Open in new tab", then right-click the video and choose "Save video as…".'
    : 'Only SD quality is available for this video.';

  body.append(title, actions, note);
  fragment.append(thumb, body);
  container.replaceChildren(fragment);
  container.hidden = false;
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
