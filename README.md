# Macalin: private tutor marketplace for Djibouti

Parents find a vetted tutor by subject, level (CEPE, BEF, Bac…), district and budget, then send a request or message the tutor on WhatsApp. *Macalin* means "teacher" in Somali.

**Features**
- Search by subject, level, district and hourly budget
- Tutor profiles with photo, subjects, levels, languages, rate and parent reviews (★)
- Lesson request form with no account needed
- Tutor dashboard: profile, incoming requests with status tracking, subscription and payments
- Admin: approve or suspend tutors, add a "Credentials verified" badge, confirm payments
- Tutors get a 30-day free trial on approval, then are hidden automatically when the subscription lapses

**Revenue built in**

| Product | Price | Effect |
|---|---|---|
| Tutor subscription, 1 month | 3,000 FDJ | Profile visible in search |
| Tutor subscription, 3 months | 7,500 FDJ | Same, discounted |
| Featured profile, 30 days | 5,000 FDJ | Top of results + "Featured" badge |

## Run it

The site is plain HTML/JS with no build step, so it runs on any static host.

```bash
# local preview
python3 -m http.server 8080   # then open http://localhost:8080
```

**Free hosting:** GitHub repo → Settings → Pages → Deploy from branch `main` / root. Netlify or Cloudflare Pages also work (drag and drop the folder).

## Backend (Supabase)

The backend is already live in the Supabase project **djib-ventures** (`xqqgmxtzbuprdjillpof`, Paris region), which `config.js` points to. To recreate it elsewhere, run the files in `supabase/migrations/` in order in the SQL editor of a new project and update `config.js`.

The browser only gets the publishable key. Every rule lives in Postgres: Row Level Security policies, plus triggers that stop users from approving their own content, giving themselves paid features or editing prices.

## Before launch

1. **Payment numbers:** put your real D-Money / Waafi / CAC Pay merchant numbers and WhatsApp in `config.js`.
2. **Make yourself admin:** sign up on the site, then run this in the Supabase SQL editor:
   ```sql
   set session_replication_role = replica;  -- skip the guard trigger for this one admin change
   update public.mac_profiles set is_admin = true
   where id = (select id from auth.users where email = 'you@example.com');
   set session_replication_role = origin;
   ```
   An **Admin** link appears in the menu after you log in again.
3. **Auth emails:** Supabase → Authentication → URL Configuration: set the Site URL to your live domain. For more than a few sign-ups an hour, add your own SMTP server (Brevo and Resend have free plans).
4. **Domain:** buy a `.dj` domain or a cheap `.com` and point it at GitHub Pages.

## How payments work (v1)

The customer sends mobile money, then pastes the transaction reference. You check it on your phone and click **Confirm** in Admin, and the database applies the purchase automatically. This works on day one with no merchant API contract. Once volume justifies it, replace this step with the D-Money or Waafi merchant API.

