// Zero-dependency static site builder: src/ -> dist/
// Each page in src/pages starts with a JSON front-matter comment:  <!-- { "title": ..., "path": ... } -->
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

const config = JSON.parse(readFileSync(join(root, 'site.config.json'), 'utf8'));
if (process.env.SITE_URL) config.url = process.env.SITE_URL;
if (process.env.API_URL) config.apiUrl = process.env.API_URL;
if (process.env.MIXPANEL_TOKEN) config.mixpanelToken = process.env.MIXPANEL_TOKEN;

// `url` is the canonical address (canonical tags, sitemap, OG). DEPLOY_URL is where this copy is hosted,
// so the same site can also be served from a sub-path such as https://user.github.io/repo.
const siteUrl = config.url.replace(/\/$/, '');
const deployUrl = (process.env.DEPLOY_URL || siteUrl).replace(/\/$/, '');
const base = new URL(deployUrl).pathname.replace(/\/$/, '');
const today = new Date().toISOString().slice(0, 10);

const read = (...parts) => readFileSync(join(...parts), 'utf8');
const hash = (file) => createHash('md5').update(readFileSync(file)).digest('hex').slice(0, 8);
const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function render(template, vars) {
  // Two passes so partials may contain tokens themselves.
  let out = template;
  for (let i = 0; i < 2; i++) {
    out = out.replace(/\{\{(\w+)\}\}/g, (token, key) => (key in vars ? vars[key] : token));
  }
  const leftover = out.match(/\{\{\w+\}\}/g);
  if (leftover) console.warn(`  ! unresolved tokens: ${[...new Set(leftover)].join(', ')}`);
  return out;
}

function parsePage(file) {
  const raw = read(src, 'pages', file);
  const match = raw.match(/^<!--([\s\S]*?)-->\s*/);
  if (!match) throw new Error(`${file}: missing front-matter comment`);
  return { meta: JSON.parse(match[1]), body: raw.slice(match[0].length), file };
}

const pageUrl = (path) => `${siteUrl}${path === '/' ? '/' : path}`;
const pageHref = (path) => `${base}${path}`;

function faqHtml(faq) {
  const items = faq
    .map((q) => `<details class="faq-item"><summary>${escapeHtml(q.q)}</summary><div class="faq-answer"><p>${q.a}</p></div></details>`)
    .join('\n');
  return `<div class="faq-list">\n${items}\n</div>`;
}

function schemaFor(meta, pages) {
  const org = { '@type': 'Organization', '@id': `${siteUrl}/#org`, name: config.name, url: `${siteUrl}/`, logo: `${siteUrl}/assets/img/icon-512.png` };
  const graph = [];

  if (meta.path === '/') {
    graph.push(org, {
      '@type': 'WebSite',
      '@id': `${siteUrl}/#website`,
      name: config.name,
      url: `${siteUrl}/`,
      publisher: { '@id': `${siteUrl}/#org` },
      inLanguage: 'en',
    });
  } else {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl}/` },
        { '@type': 'ListItem', position: 2, name: meta.breadcrumb || meta.h1 || meta.title, item: pageUrl(meta.path) },
      ],
    });
  }

  if (meta.app) {
    graph.push({
      '@type': 'WebApplication',
      name: meta.h1 || config.name,
      url: pageUrl(meta.path),
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      publisher: { '@id': `${siteUrl}/#org` },
    });
  }

  if (meta.howto) {
    graph.push({
      '@type': 'HowTo',
      name: meta.howto.name,
      step: meta.howto.steps.map((text, i) => ({ '@type': 'HowToStep', position: i + 1, name: text.split('.')[0], text })),
    });
  }

  if (meta.faq?.length) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: meta.faq.map((q) => ({
        '@type': 'Question',
        name: q.q,
        acceptedAnswer: { '@type': 'Answer', text: q.a.replace(/<[^>]+>/g, '') },
      })),
    });
  }

  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

function analyticsSnippet() {
  const tags = [];
  if (config.googleSiteVerification) tags.push(`<meta name="google-site-verification" content="${escapeAttr(config.googleSiteVerification)}">`);
  if (config.bingSiteVerification) tags.push(`<meta name="msvalidate.01" content="${escapeAttr(config.bingSiteVerification)}">`);
  if (config.googleAnalyticsId) {
    const id = escapeAttr(config.googleAnalyticsId);
    tags.push(
      `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>`,
      `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${id}');</script>`,
    );
  }
  if (config.mixpanelToken) {
    // Official async loader stub: queues calls until the SDK arrives, so main.js can track immediately.
    const options = JSON.stringify({
      debug: /^http:\/\/(localhost|127\.0\.0\.1)/.test(siteUrl),
      track_pageview: false, // sent below, after super properties are registered
      persistence: 'localStorage',
      // Clicks, rage/dead clicks, scroll depth, form submits, input changes (values are never sent) and time on page.
      autocapture: { pageview: false, page_leave: true },
      // Session Replay + heatmaps. Form inputs (pasted links, page source) are masked in recordings by default.
      record_sessions_percent: config.mixpanelSessionReplayPercent ?? 100,
      record_heatmap_data: true,
    });
    tags.push(
      `<script>(function(f,b){if(!b.__SV){var e,g,i,h;window.mixpanel=b;b._i=[];b.init=function(e,f,c){function g(a,d){var b=d.split(".");2==b.length&&((a=a[b[0]]),(d=b[1]));a[d]=function(){a.push([d].concat(Array.prototype.slice.call(arguments,0)))}}var a=b;"undefined"!==typeof c?(a=b[c]=[]):(c="mixpanel");a.people=a.people||[];a.toString=function(a){var d="mixpanel";"mixpanel"!==c&&(d+="."+c);a||(d+=" (stub)");return d};a.people.toString=function(){return a.toString(1)+".people (stub)"};i="disable time_event track track_pageview track_links track_forms track_with_groups add_group set_group remove_group register register_once alias unregister identify name_tag set_config reset opt_in_tracking opt_out_tracking has_opted_in_tracking has_opted_out_tracking clear_opt_in_out_tracking start_batch_senders people.set people.set_once people.unset people.increment people.append people.union people.track_charge people.clear_charges people.delete_user people.remove".split(" ");for(h=0;h<i.length;h++)g(a,i[h]);var j="set set_once union unset remove delete".split(" ");a.get_group=function(){function b(c){d[c]=function(){call2_args=arguments;call2=[c].concat(Array.prototype.slice.call(call2_args,0));a.push([e,call2])}}for(var d={},e=["get_group"].concat(Array.prototype.slice.call(arguments,0)),c=0;c<j.length;c++)b(j[c]);return d};b._i.push([e,f,c])};b.__SV=1.2;e=f.createElement("script");e.type="text/javascript";e.async=!0;e.src="https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js";g=f.getElementsByTagName("script")[0];g.parentNode.insertBefore(e,g)}})(document,window.mixpanel||[]);`,
      `mixpanel.init('${escapeAttr(config.mixpanelToken)}',${options});mixpanel.register({platform:'web'});mixpanel.track_pageview();</script>`,
    );
  }
  return tags.join('\n');
}

function navLinks(pages, current) {
  return pages
    .filter((p) => p.meta.nav)
    .sort((a, b) => a.meta.nav - b.meta.nav)
    .map((p) => {
      const active = p.meta.path === current ? ' aria-current="page"' : '';
      return `<li><a href="${pageHref(p.meta.path)}"${active}>${escapeHtml(p.meta.navLabel)}</a></li>`;
    })
    .join('');
}

function build() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  cpSync(join(src, 'assets'), join(dist, 'assets'), { recursive: true });
  cpSync(join(src, 'static'), dist, { recursive: true });

  const partials = Object.fromEntries(
    readdirSync(join(src, 'partials')).map((f) => [f.replace('.html', ''), read(src, 'partials', f)]),
  );
  const pages = readdirSync(join(src, 'pages')).filter((f) => f.endsWith('.html')).map(parsePage);

  const shared = {
    name: escapeHtml(config.name),
    tagline: escapeHtml(config.tagline),
    base,
    siteUrl,
    apiUrl: escapeAttr(config.apiUrl.replace(/\/$/, '')),
    apiOrigin: new URL(config.apiUrl).origin,
    email: escapeHtml(config.contactEmail),
    year: String(new Date().getFullYear()),
    updated: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    cssHash: hash(join(src, 'assets/css/style.css')),
    jsHash: hash(join(src, 'assets/js/main.js')),
    analytics: analyticsSnippet(),
    twitterSite: config.twitter ? `<meta name="twitter:site" content="${escapeAttr(config.twitter)}">` : '',
    ...Object.fromEntries(Object.entries(partials).filter(([k]) => k !== 'layout')),
  };

  for (const { meta, body, file } of pages) {
    const isNotFound = meta.path === '/404.html';
    const vars = {
      ...shared,
      title: escapeAttr(meta.title),
      description: escapeAttr(meta.description),
      canonical: pageUrl(meta.path),
      robots: meta.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large',
      ogImage: `${siteUrl}/assets/img/og-image.png`,
      nav: navLinks(pages, meta.path),
      faq: meta.faq ? faqHtml(meta.faq) : '',
      schema: isNotFound ? '' : schemaFor(meta, pages),
    };
    vars.content = render(body, vars);
    const html = render(partials.layout, vars);

    const outFile = isNotFound ? join(dist, '404.html') : join(dist, meta.path, 'index.html');
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, html);
    console.log(`  ✓ ${file} -> ${outFile.replace(root + '/', '')}`);
  }

  const indexable = pages.filter((p) => !p.meta.noindex && p.meta.path !== '/404.html');
  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...indexable
      .sort((a, b) => (b.meta.priority ?? 0.5) - (a.meta.priority ?? 0.5))
      .map((p) => `  <url><loc>${pageUrl(p.meta.path)}</loc><lastmod>${today}</lastmod><priority>${(p.meta.priority ?? 0.5).toFixed(1)}</priority></url>`),
    '</urlset>',
    '',
  ].join('\n');
  writeFileSync(join(dist, 'sitemap.xml'), sitemap);

  writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);

  writeFileSync(
    join(dist, 'site.webmanifest'),
    JSON.stringify(
      {
        name: `${config.name} – ${config.tagline}`,
        short_name: config.name,
        start_url: `${base}/`,
        scope: `${base}/`,
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1a5ce6',
        icons: [
          { src: `${base}/assets/img/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${base}/assets/img/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      null,
      2,
    ),
  );

  if (config.customDomain) writeFileSync(join(dist, 'CNAME'), `${config.customDomain}\n`);
  writeFileSync(join(dist, '.nojekyll'), '');

  if (!existsSync(join(dist, 'assets/img/og-image.png'))) {
    console.warn('  ! assets/img/og-image.png missing — run `npm run icons`');
  }
  console.log(`\nBuilt ${pages.length} pages for ${deployUrl} (canonical ${siteUrl})`);
}

build();
