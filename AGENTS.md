# Analytics Tracking — Mixpanel

This project uses **Mixpanel** for product analytics. Do not introduce other analytics tools, SDKs, or tracking libraries without explicit instruction from a user. (The optional GA4 slot in `site.config.json` predates Mixpanel and is off by default.)

## Before You Add or Modify Any Tracking

- [ ] Use the Mixpanel **browser** SDK loaded by the build (see below) — this is a static site with no bundler or npm runtime deps
- [ ] No CDP is used — call Mixpanel directly
- [ ] No consent gate is currently required. If the site starts targeting EU/UK or California users, init must be deferred until consent (`opt_out_tracking_by_default: true` + `mixpanel.opt_in_tracking()`)
- [ ] Review the tracking plan below before adding events

## Tech Stack

| Detail | Value |
|---|---|
| **Platform** | Static site (vanilla JS, `scripts/build.mjs`) on GitHub Pages; API on Cloudflare Workers |
| **Mixpanel SDK** | Browser JS SDK via official async loader, `https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js` |
| **Tracking method** | Client-side |
| **CDP (if any)** | None |
| **Consent required** | No |
| **Mixpanel project token location** | `site.config.json` → `mixpanelToken` (override with `MIXPANEL_TOKEN` env var at build time; empty disables Mixpanel) |

## Mixpanel Initialization

**File:** `scripts/build.mjs` → `analyticsSnippet()`, injected into every page via `{{analytics}}` in `src/partials/layout.html`.

- `mixpanel.init(token, { debug, track_pageview: false, persistence: 'localStorage' })`, then `mixpanel.register({ platform: 'web' })`, then `mixpanel.track_pageview()` (page view is sent after registration so it carries super properties)
- `debug` is on automatically when the build's `SITE_URL` is `http://localhost…` (i.e. `npm run dev`)
- Feature code calls the `track()` helper in `src/assets/js/main.js`, which wraps `window.mixpanel.track` in a try/catch so analytics can never break the tool

**Do not** initialize Mixpanel anywhere else or create additional instances.

## Mixpanel Identity

The site has **no user accounts**, so `mixpanel.identify()` and `mixpanel.reset()` are not used. All visitors are anonymous device IDs. If login is ever added: call `identify(user.id)` after a successful login/signup (stable internal ID, never email) and `reset()` on every logout path.

## Mixpanel Tracking Plan

### Naming conventions

- Event names: `snake_case`, `object_verb` past tense (e.g. `video_extracted`)
- Property names: `snake_case`; enum values lowercase (`"hd"`, not `"HD"`)
- Omit properties that don't apply — never send `null`, `""` or `"N/A"`
- Never send the Facebook URL, video title, or other user content as properties

### Current Mixpanel events

| Mixpanel Event | Trigger | Key Properties | File |
|---|---|---|---|
| `$mp_web_page_view` | Every page load | automatic | `scripts/build.mjs` |
| `video_extracted` | Links found and result card rendered | `source_mode` (`url`/`source`), `link_count`, `has_hd` | `src/assets/js/main.js` |
| `video_extract_failed` | Extraction fails for any reason | `source_mode`, `error_type` (`invalid_input`/`not_found`/`rate_limited`/`api_error`/`network_error`), `status_code` (API errors only) | `src/assets/js/main.js` |
| `video_download_clicked` ⭐ Value Moment | User clicks Download HD/SD or "Open in new tab" | `quality` (`hd`/`sd`), `download_method` (`direct`/`new_tab`), `source_mode` | `src/assets/js/main.js` |

Super property on all events: `platform: "web"`.

## How to Add a New Mixpanel Event

1. Check the table above; reuse existing events/properties where the concept matches.
2. Name it per the conventions above; no dynamic event names.
3. Only include properties available at the moment the event fires.
4. Call `track('event_name', { ... })` from `main.js` after the action succeeds.
5. Add a row to the table above.
6. Verify in Mixpanel Live View (run `npm run dev` — debug logging is on; requests are batched and may take ~10s to send).
