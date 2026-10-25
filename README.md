# BUOC Official Website

Bicol University Otaku Circle · Academic Year 2026–2027

This repository contains the BUOC website, officer and committee directories, Constitution and By-Laws viewer, and the Concern & Inquiry Desk.

## Concern & Inquiry Desk

The Concern Desk lets any website visitor submit an inquiry, concern, complaint, suggestion, or request with required name and email, optional contact information, and an optional attachment. Authorized officers can sign in, review reports, update statuses, and reply. Submitters can check replies and status with their report reference and email address.

The public website is hosted on GitHub Pages. Private report data, authentication, and attachments require a configured Supabase project. Email notifications require the `buoc-concern-notify` Edge Function and a verified email-provider sender. See `SETUP_CONCERN_SYSTEM.md` and `supabase/schema.sql` before enabling the system.

Never commit service-role keys, email-provider API keys, private credentials, or sensitive reports to this repository. `assets/concern-config.js` may contain only the public Supabase project URL and anon/publishable key.

## Main files

- `index.html` — website interface and interactive features.
- `assets/` — officer photographs, committee logos, CBL PDF, and public configuration.
- `assets/BUOC_CBL_Clean.pdf` — Constitution and By-Laws PDF.
- `supabase/schema.sql` — tables, validation functions, row-level security policies, and private attachment bucket.
- `supabase/functions/buoc-concern-notify/index.ts` — officer-authorized email notification function template.
- `SETUP_CONCERN_SYSTEM.md` — setup, deployment, and security checklist.
- `.nojekyll` — GitHub Pages file handling.

## Deployment

Commit and push the website changes to the repository's publishing branch. Configure Supabase separately, authorize officer accounts individually, deploy the notification function, and test the form on desktop and mobile before announcing it. The website's existing CBL viewer, committee profiles, and officers directory remain in place.

Live site: https://kichiyz.github.io/buoc-anime-cbl-website/
Repository: https://github.com/kichiyz/buoc-anime-cbl-website
