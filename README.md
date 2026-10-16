# HubSpot HTML Editor

Lets MoneyHero's PCT team change HubSpot comparison pages (ranking, offers, tags, links, page text, premiums, banners) without editing code by hand. The tool writes the new module code, checks it, and PCT pastes it back into HubSpot. Publishing stays manual, in HubSpot.

**Live tool:** https://claralam-mhg.github.io/hubspot-html-editor/

## How PCT uses it

1. Pick the page tab, then the module that holds what needs changing.
2. Press **Load live version**. Or paste the module's code from HubSpot if the live copy is out of date, or if someone published in the last 15 minutes.
3. Make the change in the form.
4. Read **Check before you copy**, press **Copy new code**, paste it over that module in HubSpot, then preview and publish.

## How it stays safe

- **Copying is blocked when the code would break the page:**
  - the code wouldn't run, or the Google structured data or CSS is broken
  - something other code relies on was removed (an id, class, data attribute, function or variable)
  - a product went missing, a link isn't https, or a required field is empty
- **Only the changed value is rewritten.** Everything else in the module is left exactly as it was.
- **Load live version starts from what's actually live.** A GitHub job reads the live page every ~15 minutes, so the tool never works from an old copy in a repo.

## Files

| File | What |
|---|---|
| `engine.js` | product-data: parse, reorder, field edits, checks |
| `modules.js` | other modules: text/link/image fields, banners, data tables, safety checks, live-page extraction |
| `review.js` | builds the new code and decides whether Copy is allowed |
| `excel.js` | reads a whole sheet pasted from the RP Product Details Excel and matches it to the page |
| `pages.js` | pages, their modules (in live order), field labels, rules |
| `app.js` + `app.src.html` | the screen; `build.mjs` bundles everything into one HTML file |
| `scripts/snapshot.mjs` | reads the live pages into `live/<page>.json` (run by the GitHub job) |
| `test.mjs` + `fixtures/` | 182 tests against real modules, saved copies of each live page, and real RP Product Details Excel exports |
| `design/` | MoneyHero design-system fonts and tokens (from the `mhg-design` skill) |

```bash
node test.mjs     # must say 0 failed
node build.mjs    # writes dist/index.html
```

## GitHub job

`.github/workflows/deploy.yml` runs on every push, every 15 minutes, and on demand (Actions → Build and publish → Run workflow). If the tests fail, nothing is published. If the live page can't be read, the tool asks PCT to paste instead.

GitHub pauses scheduled jobs in a repo with no commits for 60 days. If the live copy stops refreshing, re-enable it under Actions.

## Pages covered

Life Insurance (繁中 + EN), Critical Illness, Overseas Student Insurance, VHIS. VHIS product data (module 08) is edited here, not from the Excel (2026-10-15).
