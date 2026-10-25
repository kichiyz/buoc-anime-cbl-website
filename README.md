# BUOC Official Website

Bicol University Otaku Circle · Academic Year 2026–2027

This repository contains the BUOC website, officer and committee directories, Constitution and By-Laws viewer, and the Concern & Inquiry Desk.

## Concern & Inquiry Desk

The Concern Desk lets any website visitor submit an inquiry, concern, complaint, suggestion, or request with required name and email, optional contact information, and an optional attachment. Authorized officers can sign in, review reports, update statuses, and reply. Submitters can check replies and status with their report reference and email address.

The public website is hosted on GitHub Pages. Private report data, authentication, and attachments use Supabase. The `buoc-email-notifications` Supabase Edge Function is deployed and connected to database webhooks for new concerns, status changes, and officer replies; email delivery uses Resend with a verified sender domain. See `SETUP_CONCERN_SYSTEM.md`, `supabase/EMAIL_NOTIFICATIONS.md`, and `supabase/schema.sql` for configuration and launch checks.

Never commit service-role keys, email-provider API keys, private credentials, or sensitive reports to this repository. `assets/concern-config.js` may contain only the public Supabase project URL and anon/publishable key.

## Main files

- `index.html` — website interface and interactive features.
- `assets/` — officer photographs, committee logos, CBL PDF, and public configuration.
- `assets/BUOC_CBL_Clean.pdf` — Constitution and By-Laws PDF.
- `supabase/schema.sql` — tables, validation functions, row-level security policies, and private attachment bucket.
- `supabase/functions/buoc-email-notifications/index.ts` — server-side Resend notifications triggered by Supabase Database Webhooks.
- `SETUP_CONCERN_SYSTEM.md` — setup, deployment, and security checklist.
- `.nojekyll` — GitHub Pages file handling.

## Deployment

Commit and push the website changes to the repository's publishing branch. Configure Supabase separately, authorize officer accounts individually, deploy the notification function, and test the form on desktop and mobile before announcing it. The website's existing CBL viewer, committee profiles, and officers directory remain in place.

Live site: https://kichiyz.github.io/buoc-anime-cbl-website/
Repository: https://github.com/kichiyz/buoc-anime-cbl-website


## Launch readiness

Before announcing the Concern Desk:
- Test submission, private lookup using both reference and submitting email, status changes, and officer replies with test data.
- Confirm only active, individually authorized officer accounts can access the dashboard.
- Verify the `concern-attachments` bucket is private and signed links expire.
- Test the public form and officer dashboard on mobile and desktop, including invalid references and upload validation.
- Review Resend delivery logs and Supabase function logs after tests.
- Assign an officer to monitor incoming reports, define response expectations and escalation, and adopt a privacy/retention process before collecting real concerns.

Email is a notification channel; do not ask students to send sensitive details by replying to automated email. Never commit API keys, service-role keys, webhook secrets, or real concern records.
