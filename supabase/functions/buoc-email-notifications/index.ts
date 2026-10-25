import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("BUOC_EMAIL_WEBHOOK_SECRET") ?? "";
const MAX_ATTEMPTS = 12;
const BATCH_SIZE = 10;
const OFFICER_DESK_URL = "https://kichiyz.github.io/buoc-anime-cbl-website/officer.html";

const cors = {
  "Access-Control-Allow-Origin": "https://kichiyz.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
type EmailJob = {
  id: string; idempotency_key: string; event_type: string; reference_code: string | null;
  recipient: string; subject: string; html: string; status: string; attempts: number;
};
type NewJob = {
  idempotency_key: string; event_type: string; reference_code: string | null;
  recipient: string; subject: string; html: string; status: string;
};

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] as string));
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const serviceHeaders = () => ({
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
});
function safeError(value: unknown): string {
  return (value instanceof Error ? value.message : String(value)).slice(0, 1200);
}
async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...serviceHeaders(), ...(init.headers as Record<string, string> ?? {}) },
  });
}
async function getOfficerEmails(): Promise<string[]> {
  const response = await rest("buoc_officers?active=eq.true&select=user_id");
  if (!response.ok) throw new Error(`Could not load active BUOC officers (HTTP ${response.status})`);
  const officers = await response.json() as Array<{user_id:string}>;
  const ids = [...new Set(officers.map((o) => o.user_id).filter(Boolean))];
  if (!ids.length) throw new Error("No active BUOC officers are configured");
  const emails: string[] = [];
  // Supabase Auth admin list is paginated; don't silently assume every officer fits in page one.
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
    if (!r.ok) throw new Error(`Could not load authorized officer email addresses (HTTP ${r.status})`);
    const payload = await r.json();
    const users = (payload.users ?? []) as Array<{id:string;email?:string}>;
    for (const u of users) if (ids.includes(u.id) && u.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)) emails.push(u.email.trim().toLowerCase());
    if (users.length < 1000) break;
  }
  const unique = [...new Set(emails)];
  if (!unique.length) throw new Error("No active officers have valid Auth email addresses");
  return unique;
}
function task(key: string, eventType: string, reference: string, recipient: string, subject: string, html: string): NewJob {
  return { idempotency_key: key, event_type: eventType, reference_code: reference || null, recipient: recipient.trim().toLowerCase(), subject, html, status: "pending" };
}
async function enqueue(jobs: NewJob[]) {
  if (!jobs.length) return;
  // Unique idempotency keys make duplicate webhook deliveries safe.
  const response = await rest("buoc_email_jobs?on_conflict=idempotency_key", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(jobs),
  });
  if (!response.ok) throw new Error(`Could not persist notification jobs (HTTP ${response.status}): ${(await response.text()).slice(0,300)}`);
  console.log("BUOC notification jobs persisted", { requested: jobs.length });
}
async function updateJob(id: string, fields: Record<string, unknown>) {
  const r = await rest(`buoc_email_jobs?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`Could not update notification queue job ${id} (HTTP ${r.status})`);
}
async function claimJobs(): Promise<EmailJob[]> {
  const r = await rest("rpc/buoc_claim_email_jobs", { method: "POST", body: JSON.stringify({ p_limit: BATCH_SIZE }) });
  if (!r.ok) throw new Error(`Could not claim notification queue jobs (HTTP ${r.status}): ${(await r.text()).slice(0,300)}`);
  return await r.json() as EmailJob[];
}
function isDailyQuota(status: number, body: string) {
  return status === 429 && /daily_quota_exceeded|daily email sending quota|daily quota/i.test(body);
}
async function sendOne(job: EmailJob): Promise<{id:string|null}> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
      // Stable provider idempotency key prevents duplicate sends if a network response is lost.
      "Idempotency-Key": job.id,
    },
    body: JSON.stringify({ from: RESEND_FROM, to: [job.recipient], subject: job.subject, html: job.html }),
  });
  const body = (await response.text()).slice(0, 1500);
  if (response.ok) {
    let result: {id?:string} = {};
    try { result = JSON.parse(body); } catch { /* Provider accepted request; response body may be empty. */ }
    return { id: result.id ?? null };
  }
  const error = new Error(`Resend HTTP ${response.status}: ${body}`) as Error & { status?:number; dailyQuota?:boolean; retryAfterMs?:number };
  error.status = response.status;
  error.dailyQuota = isDailyQuota(response.status, body);
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) error.retryAfterMs = Math.min(seconds * 1000, 24 * 60 * 60 * 1000);
    else if (Number.isFinite(date)) error.retryAfterMs = Math.max(1000, Math.min(date - Date.now(), 24 * 60 * 60 * 1000));
  }
  throw error;
}
async function drainQueue() {
  const jobs = await claimJobs();
  let sent = 0, deferred = 0, dead = 0;
  console.log("BUOC notification queue drain started", { claimed: jobs.length });
  for (let index = 0; index < jobs.length; index++) {
    const job = jobs[index];
    try {
      const result = await sendOne(job);
      await updateJob(job.id, { status: "sent", sent_at: new Date().toISOString(), resend_message_id: result.id, last_error: null, locked_at: null });
      sent++;
      console.log("BUOC queued email accepted by Resend", { jobId: job.id, eventType: job.event_type, reference: job.reference_code, recipient: job.recipient, messageId: result.id });
    } catch (rawError) {
      const error = rawError as Error & {status?:number;dailyQuota?:boolean;retryAfterMs?:number};
      const message = safeError(error);
      const daily = error.dailyQuota === true;
      const permanent = error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 429;
      const exhausted = job.attempts >= MAX_ATTEMPTS;
      if (daily) {
        // Pause every due job, not just the claimed batch, to prevent each cron tick from hitting the exhausted quota.
        const resumeAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
        await updateJob(job.id, { status: "pending", next_attempt_at: resumeAt, locked_at: null, last_error: message });
        deferred++;
        for (const restJob of jobs.slice(index + 1)) {
          await updateJob(restJob.id, { status: "pending", next_attempt_at: resumeAt, locked_at: null, last_error: "Paused because Resend daily quota was exhausted." });
          deferred++;
        }
        const pauseAll = await rest("buoc_email_jobs?status=eq.pending", {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ next_attempt_at: resumeAt, last_error: "Paused because Resend daily quota was exhausted.", updated_at: new Date().toISOString() }),
        });
        if (!pauseAll.ok) console.error("BUOC could not pause all pending queue jobs", { status: pauseAll.status });
        console.error("BUOC queue paused for Resend daily quota exhaustion", { jobId: job.id, claimedDeferred: deferred, resumeAt, allPendingPaused: pauseAll.ok });
        break;
      }
      // Configuration problems such as invalid API credentials or an unverified sender may be
      // fixed by an administrator; keep those messages recoverable instead of dead-lettering them.
      const configurationFailure = error.status === 401 || error.status === 403;
      if (configurationFailure) {
        const next = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
        await updateJob(job.id, { status: "pending", next_attempt_at: next, locked_at: null, last_error: message });
        deferred++;
        const pauseRest = jobs.slice(index + 1);
        for (const restJob of pauseRest) {
          await updateJob(restJob.id, { status: "pending", next_attempt_at: next, locked_at: null, last_error: "Paused because Resend returned a configuration/authentication error." });
          deferred++;
        }
        console.error("BUOC queue paused after Resend configuration/authentication error", { status: error.status, resumeAt: next, claimedDeferred: deferred });
        break;
      }
      if (permanent || exhausted) {
        await updateJob(job.id, { status: "dead", locked_at: null, last_error: message });
        dead++;
        console.error("BUOC notification moved to dead-letter state", { jobId: job.id, eventType: job.event_type, recipient: job.recipient, attempts: job.attempts, permanent });
      } else {
        const exponential = Math.min(60_000 * 2 ** Math.max(0, job.attempts - 1), 6 * 60 * 60 * 1000);
        const waitMs = error.retryAfterMs ?? (error.status === 429 ? Math.max(exponential, 60_000) : exponential);
        const next = new Date(Date.now() + waitMs).toISOString();
        await updateJob(job.id, { status: "pending", next_attempt_at: next, locked_at: null, last_error: message });
        deferred++;
        console.warn("BUOC notification retry scheduled", { jobId: job.id, attempts: job.attempts, nextAttemptAt: next, status: error.status ?? null });
      }
    }
    // Deliberate spacing limits request bursts and helps keep provider rate limits at bay.
    if (index < jobs.length - 1) await sleep(250);
  }
  console.log("BUOC notification queue drain completed", { claimed: jobs.length, sent, deferred, dead });
  return { claimed: jobs.length, sent, deferred, dead };
}
async function buildJobs(event: Record<string, any>): Promise<{jobs:NewJob[]; reference:string; workflow:string}> {
  const table = String(event.table ?? "");
  const type = String(event.type ?? "").toUpperCase();
  const record = event.record ?? {};
  const old = event.old_record ?? {};
  const jobs: NewJob[] = [];
  let reference = String(record.reference_code ?? "");
  let workflow = "";
  if (table === "buoc_concerns" && type === "INSERT") {
    workflow = "concern_insert";
    const id = String(record.id ?? "");
    const email = String(record.submitter_email ?? "").trim().toLowerCase();
    if (!id || !email) throw new Error("Concern INSERT webhook is missing record.id or submitter_email");
    const name = record.submitter_name ?? "there";
    const ref = reference || id;
    const confirmation = `<div style="font:16px/1.6 Arial,sans-serif;color:#182746"><p>Hello ${esc(name)},</p><p>We have received your message titled <strong>${esc(record.subject)}</strong>.</p><p>Your reference number is <strong>${esc(ref)}</strong>. Keep it for follow-up.</p><p>The BUOC officers have also been notified. Please do not reply to this automated email.</p></div>`;
    jobs.push(task(`concern:${id}:submitter-confirmation`, workflow, ref, email, `BUOC received your concern — ${ref}`, confirmation));
    const officers = await getOfficerEmails();
    const officerHtml = `<div style="font:16px/1.6 Arial,sans-serif;color:#182746"><h2>New concern submitted</h2><p><b>Reference:</b> ${esc(ref)}</p><p><b>From:</b> ${esc(name)} (${esc(email)})</p><p><b>Campus:</b> ${esc(record.campus)}</p><p><b>Category:</b> ${esc(record.category)}</p><p><b>Subject:</b> ${esc(record.subject)}</p><p><b>Message:</b></p><p>${esc(record.message).replace(/\n/g,"<br>")}</p><p>Open the <a href="${OFFICER_DESK_URL}">BUOC Officer Desk</a> to review it.</p></div>`;
    for (const officer of officers) jobs.push(task(`concern:${id}:officer:${officer}`, workflow, ref, officer, `New BUOC concern: ${ref}`, officerHtml));
  } else if (table === "buoc_concerns" && type === "UPDATE" && record.status !== old.status) {
    workflow = "concern_status_update";
    const id = String(record.id ?? "");
    const email = String(record.submitter_email ?? "").trim().toLowerCase();
    if (!id || !email) throw new Error("Concern UPDATE webhook is missing record.id or submitter_email");
    const ref = reference || id;
    const status = String(record.status ?? "").replace(/_/g," ");
    const updated = String(record.updated_at ?? new Date().toISOString());
    jobs.push(task(`concern:${id}:status:${updated}:submitter`, workflow, ref, email, `BUOC concern status updated — ${ref}`,
      `<div style="font:16px/1.6 Arial,sans-serif;color:#182746"><p>Hello ${esc(record.submitter_name ?? "there")},</p><p>The status of your concern <strong>${esc(ref)}</strong> (${esc(record.subject)}) has changed to <strong>${esc(status)}</strong>.</p><p>You can check its progress using your reference number and email address.</p><p>This is an automated message; please do not reply.</p></div>`));
    const officers = await getOfficerEmails();
    const html = `<div style="font:16px/1.6 Arial,sans-serif;color:#182746"><p><strong>${esc(ref)}</strong> — ${esc(record.subject)}</p><p>Status changed from ${esc(old.status)} to <strong>${esc(status)}</strong>.</p><p>Updated by an authorized dashboard action.</p></div>`;
    for (const officer of officers) jobs.push(task(`concern:${id}:status:${updated}:officer:${officer}`, workflow, ref, officer, `BUOC concern status changed: ${ref}`, html));
  } else if (table === "buoc_concern_replies" && type === "INSERT" && record.author_role === "officer") {
    workflow = "officer_reply";
    const replyId = String(record.id ?? "");
    const concernId = String(record.concern_id ?? "");
    if (!replyId || !concernId) throw new Error("Officer reply webhook is missing record.id or concern_id");
    const lookup = await rest(`buoc_concerns?id=eq.${encodeURIComponent(concernId)}&select=id,reference_code,submitter_name,submitter_email,subject`);
    if (!lookup.ok) throw new Error(`Could not load concern metadata for reply notification (HTTP ${lookup.status})`);
    const rows = await lookup.json();
    const concern = rows[0];
    if (!concern) throw new Error(`Concern ${concernId} was not found for reply notification`);
    reference = String(concern.reference_code ?? "");
    const ref = reference || concernId;
    const reply = esc(record.body).replace(/\n/g,"<br>");
    jobs.push(task(`reply:${replyId}:submitter`, workflow, ref, concern.submitter_email,
      `BUOC replied to your concern — ${ref}`,
      `<div style="font:16px/1.6 Arial,sans-serif;color:#182746"><p>Hello ${esc(concern.submitter_name)},</p><p>A BUOC officer replied to your concern <strong>${esc(ref)}</strong> (${esc(concern.subject)}).</p><blockquote style="border-left:3px solid #73b7ff;padding-left:12px">${reply}</blockquote><p>Use your reference number and email address to check progress.</p><p>This is an automated message; please do not reply.</p></div>`));
    const officers = await getOfficerEmails();
    const html = `<div style="font:16px/1.6 Arial,sans-serif;color:#182746"><p>An officer reply was posted to <strong>${esc(ref)}</strong> — ${esc(concern.subject)}.</p><p>Reply: ${reply}</p></div>`;
    for (const officer of officers) jobs.push(task(`reply:${replyId}:officer:${officer}`, workflow, ref, officer, `Officer reply posted: ${ref}`, html));
  } else {
    workflow = "ignored";
  }
  return { jobs, reference, workflow };
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) return new Response("Unauthorized", { status: 401, headers: cors });
  if (!RESEND_API_KEY || !RESEND_FROM || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("BUOC notification configuration is incomplete", { hasResendKey:!!RESEND_API_KEY, hasSender:!!RESEND_FROM, hasSupabaseUrl:!!SUPABASE_URL, hasServiceRole:!!SERVICE_ROLE_KEY });
    return new Response("Missing email configuration secrets", { status: 500, headers: cors });
  }
  try {
    const event = await req.json();
    if (event?.action === "drain") {
      const result = await drainQueue();
      return json({ ok:true, mode:"drain", ...result });
    }
    const { jobs, reference, workflow } = await buildJobs(event);
    if (workflow === "ignored") return json({ ok:true, ignored:true, table:event.table ?? null, type:event.type ?? null });
    console.log("BUOC notification workflow started", { workflow, reference, taskCount:jobs.length });
    await enqueue(jobs);
    // Queue is durable before sending. If provider is down, jobs remain scheduled for later.
    const result = await drainQueue();
    console.log("BUOC notification workflow enqueued", { workflow, reference, taskCount:jobs.length, ...result });
    return json({ ok:true, queued:jobs.length, ...result });
  } catch (error) {
    console.error("BUOC notification workflow failed before durable enqueue or queue processing", { error:safeError(error) });
    return json({ ok:false, error:"Notification processing failed; check the private function logs." }, 500);
  }
});
