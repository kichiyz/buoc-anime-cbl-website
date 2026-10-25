import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM');
  if (!resendKey || !from) return new Response(JSON.stringify({ error: 'Email service is not configured' }), { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } });

  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return new Response('Unauthorized', { status: 401, headers: cors });
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) return new Response('Unauthorized', { status: 401, headers: cors });
  const { data: allowed, error: roleError } = await caller.rpc('buoc_is_officer');
  if (roleError || allowed !== true) return new Response('Forbidden', { status: 403, headers: cors });

  let body: { event_type?: string; concern_id?: string };
  try { body = await req.json(); } catch { return new Response('Invalid JSON', { status: 400, headers: cors }); }
  if (!['reply', 'status'].includes(body.event_type ?? '') || !/^[0-9a-f-]{36}$/i.test(body.concern_id ?? '')) {
    return new Response('Invalid request', { status: 400, headers: cors });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: report, error: reportError } = await admin.from('buoc_concerns')
    .select('reference_code,submitter_name,submitter_email,subject,status').eq('id', body.concern_id).single();
  if (reportError || !report) return new Response('Report not found', { status: 404, headers: cors });

  let description = `The status of your BUOC report is now: ${report.status.replaceAll('_', ' ')}.`;
  if (body.event_type === 'reply') {
    const { data: reply } = await admin.from('buoc_concern_replies').select('body,created_at')
      .eq('concern_id', body.concern_id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!reply) return new Response('Reply not found', { status: 404, headers: cors });
    description = `An authorized BUOC officer replied to your report:\n\n${reply.body}\n\nYou can check the report thread on the BUOC website using your reference code and submitting email.`;
  }

  const emailResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [report.submitter_email],
      subject: `BUOC report update · ${report.reference_code}`,
      text: `Hello ${report.submitter_name},\n\nThere is an update to your BUOC Concern Desk report (${report.reference_code}): ${report.subject}\n\n${description}\n\nThis is an automated notification. Please reply through the BUOC website report tracking page.`,
    }),
  });
  if (!emailResponse.ok) return new Response(JSON.stringify({ error: 'Email provider rejected the notification' }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
});
