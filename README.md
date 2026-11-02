# Alejo

An AI front desk for Nigerian hotels. It answers guests on Telegram (and by phone) in Pidgin or English, only from the hotel's own facts. When it does not know, it asks the staff, who answer once from a live dashboard, and the answer is saved for every guest after.

Live site: https://alejo-nine.vercel.app (the staff dashboard demo is at `/app`).

## How it fits together

```
Guest on Telegram ──► n8n bot workflow ──► Cohere (answers only from the knowledge base)
Guest on the phone ─► Vapi assistant ────► n8n "Vapi Tools" workflow
                                  │
                                  ▼
                        Supabase (Postgres + Auth + Realtime + Edge Functions)
                                  ▲
Staff dashboard (website/app) ────┘   live updates, replies, facts, bookings
Marketing site (website)  ───► Supabase edge function `demo-request` ► n8n ► Telegram alert
```

- **Telegram guest journey:** booking, check-in reminder with a one-tap code, questions answered from facts, staff handoff, checkout, thank-you.
- **Dashboard:** Today, Inbox, Bookings, Facts, Settings. It shows sample data until a staff member signs in, then it shows the hotel's real data and updates by itself.
- **Hosting:** the site and dashboard are static files on Vercel. Everything else runs in Supabase and n8n.

## Folders

| Folder | What is in it |
|---|---|
| `website/` | The marketing site (`index.html`, `site.css`, `site.js`) and the staff dashboard (`app/`), plain HTML, CSS and JavaScript with no build step |
| `sql/` | Database schema and policies, run in order `001` to `006` |
| `supabase/functions/` | Edge functions: `demo-request`, `staff-reply`, `staff-typing`, `telegram-proxy` |
| `execution/` | Scripts: build and update the n8n workflows, run SQL and deploy functions, build and deploy the site, end-to-end test helper |
| `knowledge/` | The 70-answer Nigerian hotel knowledge base that gets loaded into the database |
| `E2E_TEST_CHECKLIST.md` | A step-by-step manual test of the whole product |

## Set up

1. Copy `.env.example` to `.env` and fill in every value. Never commit `.env`.
2. Create a Supabase project and run the SQL files in `sql/` in order. Load the knowledge base with `python execution/load_knowledge.py`.
3. Create the n8n credentials and workflows: `python execution/build_n8n_workflows.py` (flags `--only-demo-alert`, `--only-dashboard-reply`, `--only-typing` rebuild a single workflow).
4. Deploy the edge functions: `python execution/supabase_admin.py deploy <name> supabase/functions/<name>/index.ts` (add `--verify-jwt` for `staff-reply` and `staff-typing`). Placeholders like `__ENV:NAME__` in the sources are filled from `.env` at deploy time.
5. Create your own staff login: `python execution/supabase_admin.py staff-user you@example.com "Your Name" owner`.
6. Deploy the site: `python execution/deploy_vercel.py` (needs the Vercel CLI and `vercel login`).
7. Run through `E2E_TEST_CHECKLIST.md`. `python execution/e2e_helper.py check` runs a quick pre-flight.

To preview locally: `cd website && python -m http.server 8077`, then open http://127.0.0.1:8077.

## Secrets

The anon key in `website/app/live.js` is public by design, because row-level security decides what a signed-in user can see. Every other key lives in `.env` and in the n8n credential store. The service-role key is never used in the browser.

## Sample content

Prices, the BrightSide Hotel facts, the demo email `demo@alejo.example`, and the sample guests in the demo dashboard are placeholders to replace before a real launch.

## Credits

Lagos photographs are from Wikimedia Commons (credits are in the site footer); music in any promo video is "Happy Beats / Business Moves" by Sascha Ende (CC BY 4.0).
