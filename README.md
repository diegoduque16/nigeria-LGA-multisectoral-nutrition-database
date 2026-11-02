# LGA Multi-Sectoral Nutrition Scorecard Data Reporting System

(Repository: Nigeria LGA multisectoral nutrition database)

A simple, DHIS2-compatible aggregate reporting system. LGAs report monthly/quarterly/yearly numbers by sector,
states review them, and the system gives a state-level picture and exports JSON files in the ALMA Export format
(metadata `organisationUnits_indicators.json` + data `dataValues_<period>.json`). Org units use the DHIS2 IDs
(37 states, 774 LGAs).

Runs on Cloudflare Workers + D1.

## Deploy (Cloudflare Workers Builds)
1. Create a D1 database named `lga-reporting` and put its ID in `wrangler.toml` (`database_id`).
2. Connect this repository to a Worker named `nigeria-lga-multisectoral-nutrition-database`; deploy command:
   `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`
3. Add a **Secret** `SETUP_KEY` (any long phrase). Open the site and use it once to create the first system administrator.

## Develop
- `npm test` – API tests (Node 22+, uses node:sqlite)
- `npm run dev` – local server on http://localhost:8788 (setup key `local-setup-key`)
