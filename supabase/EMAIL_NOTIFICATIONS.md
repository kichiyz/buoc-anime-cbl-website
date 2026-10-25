# BUOC Concern Desk email notifications — durable queue edition

The notification function now persists each recipient's email as a private queue job before attempting delivery. Duplicate webhook events are deduplicated, temporary failures are rescheduled, Resend daily-quota exhaustion pauses the queue instead of retrying every recipient, and permanently failing messages are retained in a dead-letter state for review.

## Before deploying

1. In Supabase SQL Editor, run the complete supabase/migrations/20261026000100_buoc_email_queue.sql file. It is safe to run again. It creates the private queue table and secure RPCs.
2. Confirm the existing three database webhooks are enabled and send the complete record (and old record for UPDATE) to the Edge Function:
   - buoc_concerns_insert_email: public.buoc_concerns, INSERT
   - buoc_concerns_update_email: public.buoc_concerns, UPDATE
   - buoc_replies_insert_email: public.buoc_concern_replies, INSERT
3. Ensure each webhook includes x-webhook-secret matching the Supabase Edge Function secret BUOC_EMAIL_WEBHOOK_SECRET. Never place that secret in GitHub Pages or commit it to GitHub.
4. Ensure the Resend sender domain is verified and the sender is BUOC Concern Desk <notifications@buoc-otaku-circle.isroot.in> (or another verified sender configured in RESEND_FROM).

## Deploy from Windows

```bat
cd "C:\Users\Kichi Yz M. Lozano\buoc-anime-cbl-website"
git pull
supabase link --project-ref zypmvgdfynkcrqlewteg
supabase functions deploy buoc-email-notifications --no-verify-jwt
```

If git pull fails or reports a conflict, resolve it before deploying. Confirm the deployed function logs show the new queue messages such as BUOC notification jobs persisted and BUOC notification queue drain completed.

## Automatic retry scheduler (required for recovery when no new webhook arrives)

The queue keeps failed messages, but they are retried automatically only when the scheduled drain runs. In Supabase Dashboard, enable the pg_cron, pg_net, and Vault extensions if they are available for your project. Store the function URL and the existing webhook secret in Vault; never hardcode the actual secret in a committed SQL file.

Example SQL to run in the Supabase SQL Editor after enabling those extensions (replace the Vault secret values locally in the SQL editor; do not save them in GitHub):

```sql
select vault.create_secret(
  'https://zypmvgdfynkcrqlewteg.supabase.co/functions/v1/buoc-email-notifications',
  'buoc_email_function_url',
  'Private BUOC email queue worker URL'
);
select vault.create_secret(
  'REPLACE_WITH_THE_EXACT_BUOC_EMAIL_WEBHOOK_SECRET',
  'buoc_email_webhook_secret',
  'Private shared secret for BUOC email webhooks and queue worker'
);

select cron.schedule(
  'buoc-email-queue-drain-every-minute',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'buoc_email_function_url' limit 1),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'buoc_email_webhook_secret' limit 1)
    ),
    body := '{"action":"drain"}'::jsonb,
    timeout_milliseconds := 10000
  );
  $job$
);
```

Run the Vault secret creation only once. If a secret name already exists, update/replace it using the Vault UI or your project's approved secret-management process rather than creating duplicates. Verify the cron job in the Supabase Cron dashboard and inspect pg_net request results and Edge Function logs. The job runs once per minute and drains up to 10 messages per invocation. If a project plan or extension policy prevents pg_cron/pg_net, use an external scheduler to POST {"action":"drain"} to the function URL with the same private header; never call it from the public website.

## Retry and failure behavior

- Duplicate webhook deliveries are safe: queue rows have stable unique idempotency keys.
- The function sends sequentially with spacing, and includes a stable Resend idempotency key for each queued job.
- Network failures, 429 rate limits, and 5xx errors are scheduled with backoff. Resend's Retry-After is respected when provided.
- A daily_quota_exceeded error pauses the affected queue work for 12 hours; the scheduler will retry after that time. If the Resend quota does not reset/increase, the job will be deferred again rather than hammered.
- Permanent 4xx errors (except 429) and jobs that reach 12 attempts move to dead; they are retained for inspection and are not silently discarded.
- Jobs stuck in processing for more than 10 minutes can be reclaimed.
- Queue payloads contain email body content and addresses. The table has RLS enabled and no access for anon or authenticated; do not grant public access.

## Inspect queue health (SQL Editor, privileged account only)

```sql
select public.buoc_email_queue_stats();

select id, event_type, reference_code, recipient, status, attempts,
       next_attempt_at, sent_at, last_error, created_at
from public.buoc_email_jobs
where status in ('pending','processing','dead')
order by created_at desc
limit 100;
```

The second query contains personal email addresses and error details. Restrict who can view or export its results. Do not share screenshots containing real addresses or concern text.

## Controlled test plan

Do not run tests while Resend daily quota is exhausted. After quota availability is confirmed:

1. Submit exactly one non-sensitive test concern and verify one submitter confirmation and one message per active officer.
2. Change its status once and verify the submitter and officers are notified.
3. Post one officer reply and verify the submitter and officers are notified.
4. Inspect queue rows and Resend logs. Sent jobs should be sent with a Resend message ID where returned.
5. Test recovery deliberately in a safe test environment: invalid sender/key (permanent failure), temporary provider failure, HTTP 429 rate limit, daily quota exhaustion, duplicate webhook delivery, and a function interruption after queue insertion. Confirm no task is lost and retries are scheduled.
6. Remove test concerns according to the organization's retention policy; do not use real complaint details for testing.

## Important limitations

No software can guarantee delivery if Resend blocks the account, the daily quota remains exhausted, the verified sender/domain fails, a recipient mailbox rejects messages, or the scheduler/database is unavailable. This design durably queues and retries recoverable failures, but it does not make the provider quota unlimited. A Resend HTTP 200 means the provider accepted the message; actual delivery/bounce status should still be checked in Resend. Emails are notifications, not a substitute for monitoring the Concern Desk.
