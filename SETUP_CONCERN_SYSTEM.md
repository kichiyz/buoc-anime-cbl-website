# BUOC Concern & Inquiry Desk — setup and maintenance guide

This guide documents the Concern & Inquiry Desk integrated into the BUOC GitHub Pages website. It supplements, rather than replaces, the existing officers directory, committee profiles, anime-inspired design, and CBL reader.

## Architecture

- **Frontend:** GitHub Pages, primarily `index.html` and `officer.html`.
- **Public browser configuration:** `assets/concern-config.js`, loaded by the public site and officer portal.
- **Backend:** Supabase database, authentication, row-level security, and private attachment storage.
- **Email:** the `buoc-email-notifications` Supabase Edge Function, a durable email queue, database webhooks, and Resend.
- **Public site:** https://kichiyz.github.io/buoc-anime-cbl-website/

## Current project configuration

The repository's `assets/concern-config.js` is already the live client configuration file. Do not follow older instructions to replace its valid values with placeholders. It may contain only the Supabase project URL and the public anon/publishable key. These are browser-visible values; never place a service-role key, Resend API key, webhook secret, password, or other private credential in this file.

For a new environment, obtain the project URL and public anon/publishable key from Supabase Project Settings → API, then update this file. Do not create a second competing configuration file unless the application is deliberately changed to load it.

## Database and access control

- The base schema is maintained in `supabase/schema.sql`.
- Versioned database changes belong in `supabase/migrations/`. Apply each required migration in Supabase SQL Editor or through the approved Supabase CLI workflow before deploying code that depends on it.
- Keep row-level security enabled. Do not add public read access to concerns or replies.
- Create individual Supabase Auth accounts for officers and add only verified, currently authorized officers to `public.buoc_officers`. Revoke access when an officer is no longer authorized.
- Keep the attachment bucket private and use expiring signed links. File MIME types can be spoofed; validate files server-side if the system is used for sensitive cases.

The officer allowlist SQL pattern is:

```sql
insert into public.buoc_officers(user_id, officer_name, officer_role, active)
select id, 'Officer Full Name', 'officer', true
from auth.users
where lower(email) = lower('officer@example.com')
on conflict (user_id) do update
set officer_name = excluded.officer_name,
    officer_role = excluded.officer_role,
    active = true;
```

Replace the sample name and email with verified details. The Auth user must already exist. Never share accounts or passwords.

## Email notification maintenance

Use [`supabase/EMAIL_NOTIFICATIONS.md`](supabase/EMAIL_NOTIFICATIONS.md) as the maintained source of truth for the notification queue, Edge Function deployment, database webhooks, Vault secrets, scheduled queue drain, retry/backoff behavior, quota handling, and diagnostics.

Important operating rules:

- Keep `BUOC_EMAIL_WEBHOOK_SECRET`, `RESEND_API_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in Supabase secrets/Vault only, not in the website or repository.
- Ensure the three expected webhook events are configured: concern INSERT, concern UPDATE, and reply INSERT.
- The scheduled queue drain is necessary to retry pending jobs when no new webhook event occurs.
- Resend quota exhaustion pauses pending messages until the retry time. Confirm quota status and provider logs before sending repeated test concerns.
- A queue status of `sent` means the provider accepted the request; confirm delivery/bounce events when inbox delivery matters.

## Security and launch checklist

- Test with non-sensitive test data before inviting public submissions.
- Verify rate limiting and add server-side CAPTCHA verification and IP-based abuse controls before broad public launch if these are not already deployed. Do not trust an unverified CAPTCHA token.
- Check upload size and file type server-side; consider malware scanning for user-supplied files.
- Never expose concern records, submitter details, private attachments, API secrets, or service-role credentials publicly.
- Publish a short privacy notice, define access and escalation responsibilities, and establish a retention/deletion policy.
- Test anonymous submission, report lookup using both reference and submitter email, officer authorization, replies, status changes, invalid references, upload rejection, and mobile Safari/Chrome.

## Deployment workflow

For frontend changes, review the diff, preserve existing asset paths and functionality, then commit and push to the `main` branch used by GitHub Pages. Test the live site on desktop and mobile after publishing.

For backend changes, use the Supabase CLI linked to the intended project, apply migrations in order, deploy the affected Edge Function, and manage secrets through Supabase's secure secret-management tools. Do not assume a GitHub Pages commit deploys database or Edge Function changes.

## Operational SQL files

SQL files in `supabase/` can change production data or permissions. Treat them as maintained operational scripts—not disposable scratch files. Read and validate each script, verify its target, and confirm backups/retention requirements before running destructive operations.
