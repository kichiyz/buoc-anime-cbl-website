# BUOC Concern & Inquiry Desk — setup guide

This adds a concern submission form, private report lookup, an authenticated officer dashboard, status updates, replies, and a private attachment bucket to the existing BUOC GitHub Pages site. It does not replace the existing directory, committee profiles, or CBL viewer.

## Architecture

- Frontend: GitHub Pages (`index.html`) with the existing anime-inspired navy/gold theme.
- Backend/database/authentication/storage: Supabase.
- Email notifications: Supabase Edge Function plus an email provider such as Resend. Never put the email-provider API key or Supabase `service_role` key in browser code or GitHub Pages.
- Public visitors can submit reports and check status using the report reference + submitting email. Only accounts explicitly added to `buoc_officers` can view all reports and reply.

## 1. Create Supabase project and configure the frontend

1. Create a Supabase project and open **SQL Editor**.
2. Run the entire `supabase/schema.sql` file.
3. In Supabase Project Settings → API, copy the **Project URL** and **anon/publishable key**.
4. Edit `assets/concern-config.js` and replace `YOUR_PROJECT_ID` and `YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY`. These are public browser values; do not use a `service_role` or secret key.
5. Commit and push the site to GitHub Pages. The Concern Desk will remain disabled until the config has real values.

## 2. Create officer accounts and authorize them

1. In Supabase Authentication, create an account for each current authorized BUOC officer. Use individual accounts; never share passwords.
2. Confirm the identity of each officer before authorizing the account.
3. In SQL Editor, run the following once per officer, replacing the email and name. The user must already exist in `auth.users`:

```sql
insert into public.buoc_officers(user_id, officer_name, officer_role, active)
select id, 'Officer Full Name', 'officer', true
from auth.users where lower(email)=lower('officer@example.com')
on conflict (user_id) do update
set officer_name=excluded.officer_name, officer_role=excluded.officer_role, active=true;
```

To revoke access, set `active=false` or delete that officer row. Keep the officer allowlist limited to currently authorized officers. All active officers can read and reply to all reports, as requested.

## 3. Email notifications

The browser calls the Edge Function named `buoc-concern-notify` after an officer reply or status change. For actual email delivery, deploy an Edge Function that:

- verifies the caller's Supabase JWT and `buoc_is_officer()` authorization;
- accepts only `event_type` of `reply` or `status` and a valid concern ID;
- fetches the report and recent reply using server-side credentials;
- sends an email to the submitter using a provider API key stored as an Edge Function secret (for example `RESEND_API_KEY`) and a verified sender address;
- never returns the report or private contact details to an unauthenticated caller;
- applies request limits and logs delivery failures without logging the full report body.

Set the function secrets in Supabase, not in this repository. Add an INSERT database webhook or a separate edge-function call if you also want an automatic email receipt immediately after initial submission. Test email delivery, spam-folder behavior, and bounced addresses before announcing the system. Email is a notification channel; private replies remain in the website report thread.

## 4. Security checklist before launch

- **CAPTCHA and rate limiting:** The included RPC limits three submissions per email per 10 minutes, but email-only throttling can be bypassed. Before public launch, route submissions through an Edge Function with Cloudflare Turnstile (or equivalent) verification and IP-based rate limiting. Do not trust a CAPTCHA token unless it is verified server-side.
- **Attachment controls:** The private bucket caps uploads at 5 MB and limits MIME types. MIME types can be spoofed; consider malware scanning and verify file signatures in a server-side upload function before relying on attachments for sensitive cases.
- **Access control:** Keep RLS enabled. Never add public `SELECT` access to the concerns or replies tables, and never expose service-role credentials in HTML, JavaScript, repository files, or GitHub Actions logs.
- **Email privacy:** Use BCC or individual messages; do not disclose submitters to other reporters. Avoid placing sensitive complaint details in email subject lines.
- **Data minimization:** Publish a short privacy notice and retention period, restrict access to verified officers, and remove old reports/attachments according to BUOC policy and applicable privacy requirements.
- **Operational handling:** Define who monitors new reports, expected response time, escalation for sensitive complaints, and how officer access is removed when their term ends.
- **Test cases:** Test anonymous submission, malformed input, attachment too large/wrong type, unknown report reference, mismatched email, unauthorized officer login, reply, status change, and mobile Safari/Chrome.

## Current implementation notes

The supplied frontend includes submission and tracking UI, Supabase authentication, officer dashboard, report status changes, reply creation, and private signed attachment links. `schema.sql` implements the database and access policies. The email Edge Function and CAPTCHA-protected public submission endpoint are intentionally not included as a deployed service because they require project-specific secrets and deployment. Do not announce this as fully operational until those services are configured and tested.
