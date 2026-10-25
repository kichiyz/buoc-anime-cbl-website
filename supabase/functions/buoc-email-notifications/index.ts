import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("BUOC_EMAIL_WEBHOOK_SECRET") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "https://kichiyz.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] as string));
}

async function sendEmail(to: string, subject: string, html: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html }),
  });
  if (!response.ok) throw new Error(`Resend error ${response.status}: ${(await response.text()).slice(0, 300)}`);
}

async function sendOfficerEmails(subject: string, html: string) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Missing Supabase server credentials");
  const headers = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };
  const officerResponse = await fetch(`${SUPABASE_URL}/rest/v1/buoc_officers?active=eq.true&select=user_id,officer_name,officer_role`, { headers });
  if (!officerResponse.ok) throw new Error("Could not load active BUOC officers");
  const officers = await officerResponse.json() as Array<{user_id:string;officer_name:string;officer_role:string}>;
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, { headers });
  if (!userResponse.ok) throw new Error("Could not load authorized officer email addresses");
  const userPayload = await userResponse.json();
  const users = (userPayload.users ?? []) as Array<{id:string;email?:string}>;
  const emails = [...new Set(officers.map((o) => users.find((u) => u.id === o.user_id)?.email?.trim().toLowerCase() ?? "").filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
  if (!emails.length) throw new Error("No active officers have valid email addresses");
  const results = await Promise.allSettled(emails.map((email) => sendEmail(email, subject, html)));
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed) throw new Error(`Officer notification delivery failed for ${failed} recipient(s)`);
}
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  // Database Webhook requests must carry the shared secret. Never expose this value in client-side code.
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401, headers: cors });
  }
  if (!RESEND_API_KEY || !RESEND_FROM || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response("Missing email configuration secrets", { status: 500, headers: cors });
  }

  try {
    const event = await req.json();
    const table = String(event.table ?? "");
    const type = String(event.type ?? "").toUpperCase();
    const record = event.record ?? {};
    const oldRecord = event.old_record ?? {};
    let subject = "";
    let detail = "";
    let reference = "";
    let submitterEmail = "";
    let submitterName = "";

    if (table === "buoc_concerns" && type === "INSERT") {
      reference = record.reference_code ?? "";
      submitterEmail = record.submitter_email ?? "";
      submitterName = record.submitter_name ?? "there";
      subject = `BUOC received your concern — ${reference}`;
      detail = `<p>Hello ${esc(submitterName)},</p><p>We have received your message titled <strong>${esc(record.subject)}</strong>.</p><p>Your reference number is <strong>${esc(reference)}</strong>. Keep it for follow-up.</p><p>The BUOC officers have also been notified. Please do not reply to this automated email.</p>`;
      await sendEmail(submitterEmail, subject, `<div style="font:16px/1.6 Arial,sans-serif;color:#182746">${detail}</div>`);
      await sendOfficerEmails(`New BUOC concern: ${reference}`, `<div style="font:16px/1.6 Arial,sans-serif;color:#182746"><h2>New concern submitted</h2><p><b>Reference:</b> ${esc(reference)}</p><p><b>From:</b> ${esc(submitterName)} (${esc(submitterEmail)})</p><p><b>Campus:</b> ${esc(record.campus)}</p><p><b>Category:</b> ${esc(record.category)}</p><p><b>Subject:</b> ${esc(record.subject)}</p><p><b>Message:</b></p><p>${esc(record.message).replace(/\n/g, "<br>")}</p><p>Open the <a href="https://kichiyz.github.io/buoc-anime-cbl-website/officer.html">BUOC Officer Desk</a> to review it.</p></div>`);
    } else if (table === "buoc_concerns" && type === "UPDATE" && record.status !== oldRecord.status) {
      reference = record.reference_code ?? "";
      submitterEmail = record.submitter_email ?? "";
      submitterName = record.submitter_name ?? "there";
      const status = String(record.status ?? "").replace(/_/g, " ");
      await sendEmail(submitterEmail, `BUOC concern status updated — ${reference}`, `<div style="font:16px/1.6 Arial,sans-serif;color:#182746"><p>Hello ${esc(submitterName)},</p><p>The status of your concern <strong>${esc(reference)}</strong> (${esc(record.subject)}) has changed to <strong>${esc(status)}</strong>.</p><p>You can check its progress using the reference number and email address you submitted.</p><p>This is an automated message; please do not reply.</p></div>`);
      await sendOfficerEmails(`BUOC concern status changed: ${reference}`, `<div style="font:16px/1.6 Arial,sans-serif;color:#182746"><p><strong>${esc(reference)}</strong> — ${esc(record.subject)}</p><p>Status changed from ${esc(oldRecord.status)} to <strong>${esc(status)}</strong>.</p><p>Updated by an authorized dashboard action.</p></div>`);
    } else if (table === "buoc_concern_replies" && type === "INSERT" && record.author_role === "officer") {
      // Retrieve report metadata using the service-role key, which stays in Edge Function secrets only.
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const lookup = await fetch(`${supabaseUrl}/rest/v1/buoc_concerns?id=eq.${encodeURIComponent(record.concern_id)}&select=reference_code,submitter_name,submitter_email,subject`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      if (!lookup.ok) throw new Error("Could not load concern metadata for reply notification");
      const rows = await lookup.json();
      const concern = rows[0];
      if (concern) {
        const safeRef = esc(concern.reference_code);
        await sendEmail(concern.submitter_email, `BUOC replied to your concern — ${concern.reference_code}`, `<div style="font:16px/1.6 Arial,sans-serif;color:#182746"><p>Hello ${esc(concern.submitter_name)},</p><p>A BUOC officer replied to your concern <strong>${safeRef}</strong> (${esc(concern.subject)}).</p><blockquote style="border-left:3px solid #73b7ff;padding-left:12px">${esc(record.body).replace(/\n/g, "<br>")}</blockquote><p>Use your reference number and email address to check your concern's progress.</p><p>This is an automated message; please do not reply.</p></div>`);
        await sendOfficerEmails(`Officer reply posted: ${concern.reference_code}`, `<div style="font:16px/1.6 Arial,sans-serif;color:#182746"><p>An officer reply was posted to <strong>${safeRef}</strong> — ${esc(concern.subject)}.</p><p>Reply: ${esc(record.body).replace(/\n/g, "<br>")}</p></div>`);
      }
    } else {
      return new Response(JSON.stringify({ ignored: true, table, type }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("BUOC notification failure", error);
    return new Response("Notification delivery failed", { status: 500, headers: cors });
  }
});
