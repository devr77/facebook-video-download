# VidFetch – Facebook Video Downloader

A fast, SEO-optimised Facebook video downloader (like fdown.net), in two parts:

| Part | Where it runs | What it does |
|---|---|---|
| **Static site** (`src/` → `dist/`) | GitHub Pages (free) | UI, SEO pages, private-video tool (runs fully in the browser) |
| **API** | `saas-backend` Worker (`https://app.toolsbase.org`) | `/v1/downloader/extract` reads the Facebook page and returns HD/SD links; `/v1/downloader/download` streams the file as an attachment |

GitHub Pages can only host static files, and browsers can't fetch facebook.com directly (CORS), so link-based downloads go through the backend. The API code lives in the `saas-backend` repo: `src/routes/downloader.ts` and `src/lib/facebook.ts`.

## Project structure

```
site.config.json          ← brand name, site URL, API URL, analytics — edit this first
src/
  pages/*.html            ← one file per page; JSON front matter = title, description, FAQ, schema
  partials/*.html         ← layout, header, footer, tool widgets (used as {{tool}}, {{faq}}, …)
  assets/css/style.css
  assets/js/main.js       ← UI logic
  assets/js/extract.js    ← link extractor for the private-video tool (mirror of saas-backend src/lib/facebook.ts)
  assets/img/             ← generated icons + og-image.png
  static/                 ← copied as-is to site root (favicon.svg)
scripts/
  build.mjs               ← zero-dependency builder (pages, sitemap.xml, robots.txt, manifest)
  serve.mjs               ← local preview server
  icons.sh                ← regenerates PNG icons / OG image (needs rsvg-convert)
.github/workflows/deploy.yml  ← auto-deploys the site to GitHub Pages on push to main
```

## SEO features

- Unique `<title>`, meta description and canonical URL per page
- Open Graph + Twitter cards with a 1200×630 share image
- JSON-LD: `Organization`, `WebSite`, `WebApplication`, `HowTo`, `FAQPage`, `BreadcrumbList`
- Auto-generated `sitemap.xml` and `robots.txt`
- Keyword landing pages (Reels, Private, How-to guide, FAQ), with internal linking between them
- Semantic HTML, accessible (skip link, ARIA live regions, keyboard focus), dark mode
- No frameworks: one CSS file and one small JS module, so it loads quickly
- Optional Google Analytics and Search Console / Bing verification via config

## Setup

### 1. Configure

Edit `site.config.json`:

```json
{
  "name": "VidFetch",
  "url": "https://<username>.github.io/<repo>",   // or https://yourdomain.com
  "apiUrl": "https://app.toolsbase.org",
  "contactEmail": "you@example.com",
  "customDomain": ""                               // e.g. "yourdomain.com" → writes CNAME
}
```

To rename the brand, change `name` and the text in `scripts/og-image.svg`, then run `npm run icons`.

### 2. The API (saas-backend)

The endpoints ship with `saas-backend`, which deploys to production on every push to its `main`. In production, CORS only accepts `*.toolsbase.org` plus the origins in `EXTRA_CORS_ORIGINS` (`env.production.vars` in its `wrangler.jsonc`), which is set to `https://devr77.github.io`. If you move this site to a custom domain, add that origin there.

### 3. Deploy the site (GitHub Pages)

```bash
git init && git add . && git commit -m "Initial site"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

Then in the GitHub repo, go to **Settings → Pages → Source: GitHub Actions**. Every push to `main` rebuilds and deploys.

### 4. After launch

- Submit `https://your-site/sitemap.xml` in Google Search Console and Bing Webmaster Tools
- Add verification codes and your GA4 ID to `site.config.json`

## Local development

```bash
cd ../saas-backend && npm run dev   # API on http://localhost:3000
npm run dev          # builds with local URLs and serves http://localhost:8000
```

## Adding a page

Create `src/pages/my-page.html`:

```html
<!--
{
  "path": "/my-page/",
  "title": "Page title – {{name}}",
  "description": "Meta description (150–160 chars).",
  "breadcrumb": "My Page",
  "priority": 0.5,
  "faq": [{ "q": "Question?", "a": "Answer." }]
}
-->
<section class="page-header">…</section>
{{faq}}
```

It is added to the sitemap automatically. Add `"nav": 6, "navLabel": "My Page"` to show it in the header.

## Notes

- Facebook changes its markup regularly. If extraction stops working, update the patterns in **both** `saas-backend/src/lib/facebook.ts` (link downloads) and `src/assets/js/extract.js` here (private-video tool).
- Facebook may serve login walls to some datacenter IPs. The backend tries several user agents before giving up.
- Include a clear "only download content you own or have permission to use" policy (already in Terms/DMCA pages).
