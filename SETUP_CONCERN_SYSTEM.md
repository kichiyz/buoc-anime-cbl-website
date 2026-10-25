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

Follow the maintained, complete deployment and recovery guide in [supabase/EMAIL_NOTIFICATIONS.md](supabase/EMAIL_NOTIFICATIONS.md). It documents the durable queue migration, the Edge Function deployment, all three database webhooks, secrets, automatic queue-drain scheduling, retries, dead-letter inspection, and controlled testing.

Important: the notification queue migration must be applied in Supabase SQL Editor before deploying the queue-enabled function. Set up the scheduled drain (Supabase pg_cron + pg_net + Vault, or a trusted external scheduler) so pending messages are retried even when no new concern/reply/status webhook arrives. Never put the Resend API key, service-role key, or webhook secret in browser code or GitHub.

## 4. Security checklist before launch

- **CAPTCHA and rate limiting:** The included RPC limits three submissions per email per 10 minutes, but email-only throttling can be bypassed. Before public launch, route submissions through an Edge Function with Cloudflare Turnstile (or equivalent) verification and IP-based rate limiting. Do not trust a CAPTCHA token unless it is verified server-side.
- **Attachment controls:** The private bucket caps uploads at 5 MB and limits MIME types. MIME types can be spoofed; consider malware scanning and verify file signatures in a server-side upload function before relying on attachments for sensitive cases.
- **Access control:** Keep RLS enabled. Never add public `SELECT` access to the concerns or replies tables, and never expose service-role credentials in HTML, JavaScript, repository files, or GitHub Actions logs.
- **Email privacy:** Use BCC or individual messages; do not disclose submitters to other reporters. Avoid placing sensitive complaint details in email subject lines.
- **Data minimization:** Publish a short privacy notice and retention period, restrict access to verified officers, and remove old reports/attachments according to BUOC policy and applicable privacy requirements.
- **Operational handling:** Define who monitors new reports, expected response time, escalation for sensitive complaints, and how officer access is removed when their term ends. Test a full concern lifecycle on mobile and desktop before launch.
- **Test cases:** Test anonymous submission, malformed input, attachment too large/wrong type, unknown report reference, mismatched email, unauthorized officer login, reply, status change, and mobile Safari/Chrome.

## Current implementation notes

The frontend includes submission and tracking UI, Supabase authentication, officer dashboard, report status changes, reply creation, and private signed attachment links. `schema.sql` defines the database and access policies. The Resend notification function is deployed separately and configured through Supabase secrets and database webhooks. A CAPTCHA-verified, IP-rate-limited public submission endpoint is not documented as deployed here; email-only throttling may be bypassed. Before broad public launch, consider server-side CAPTCHA verification and IP-based rate limiting, and test all workflows with non-sensitive test reports.
