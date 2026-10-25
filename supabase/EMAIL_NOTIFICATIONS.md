# BUOC Concern Desk email notifications

This adds a server-side Supabase Edge Function for Resend. It does not modify the existing dashboard or database schema. Notifications are sent for:
- new concerns: submitter acknowledgement + officer inbox alert;
- status changes: submitter update + officer inbox alert;
- officer replies: submitter reply alert + officer inbox alert.

## 1. Set up Resend
1. Create a Resend account at https://resend.com.
2. Verify a sending domain or sender address and copy the exact verified sender, for example `BUOC Concern Desk <concerns@your-verified-domain.example>`. Do not use the example literally.
3. Create a Resend API key. Keep it private.

## 2. Deploy the Edge Function
From the repository root, with the Supabase CLI installed and logged in:
```sh
supabase link --project-ref zypmvgdfynkcrqlewteg
supabase functions deploy buoc-email-notifications --no-verify-jwt
``
The function intentionally disables JWT verification because Supabase Database Webhooks send server-to-server requests. It independently checks the `x-webhook-secret` header. Never call it from the browser.

Set secrets (replace values locally; do not commit them):
```sh
supabase secrets set RESEND_API_KEY="re_..." RESEND_FROM="BUOC Concern Desk <your-verified-sender>" OFFICER_NOTIFICATION_EMAIL="your-officer-inbox@example.com" BUOC_EMAIL_WEBHOOK_SECRET="a-long-random-secret" 
``
Generate a strong secret locally, for example with `openssl rand -hex 32`. Use the same value in the Database Webhook header. The function also uses Supabase's platform-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; do not manually publish either in frontend code.

## 3. Configure Database Webhooks in Supabase
In Supabase Dashboard → Database → Webhooks, create three HTTP webhooks, each using POST and JSON payload:
- `buoc_concerns_insert_email`: table `public.buoc_concerns`, event INSERT.
- `buoc_concerns_update_email`: table `public.buoc_concerns`, event UPDATE.
- `buoc_replies_insert_email`: table `public.buoc_concern_replies`, event INSERT.

For each webhook URL use:
`https://zypmvgdfynkcrqlewteg.supabase.co/functions/v1/buoc-email-notifications`

Add header:
`x-webhook-secret: <the exact BUOC_EMAIL_WEBHOOK_SECRET value>`

If the UI allows selecting columns for UPDATE, leave it to send the full old and new records. The function ignores updates where status did not change. For INSERT webhooks, send the full record.

## 4. Test safely
1. Submit a test concern using an inbox you control. Confirm the submitter acknowledgement and officer alert arrive.
2. Change that test concern's status from the dashboard. Confirm both status notifications arrive.
3. Post a test officer reply. Confirm both reply notifications arrive.
4. Check Supabase Edge Function logs and Resend email logs if any message fails.
5. Test with a non-sensitive report before enabling for real users.

## Notes
- Email delivery is asynchronous and depends on Resend sender verification, account limits, and correct secrets.
- The function never sends attachments or signed attachment links by email.
- This function sends notification emails only; replies are still posted through the existing dashboard / concern lookup workflow.
- Do not put API keys, service-role keys, or the webhook secret in GitHub Pages files, SQL committed to the repository, or public issue comments.
- The submitter's email address is user-provided; the function sends only to that address and the configured officer inbox.
