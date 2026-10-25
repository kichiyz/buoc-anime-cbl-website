# BUOC Official Website

Bicol University Otaku Circle (BUOC) · Academic Year 2026–2027

The official BUOC website brings together organizational information, the officers directory, committee profiles, the Constitution and By-Laws (CBL) reader, and the private Concern & Inquiry Desk.

- **Live website:** https://kichiyz.github.io/buoc-anime-cbl-website/
- **Repository:** https://github.com/kichiyz/buoc-anime-cbl-website
- **Publishing branch:** `main` (GitHub Pages)

## Website features

- **Welcome and organization information:** responsive, Japanese/anime-inspired presentation.
- **Officers directory:** interactive organizational chart and individual profiles with positions, committee/campus assignments, duties, and term/source notes where available. Nheil Rammstein R. Visayas is listed in two roles—Auditor and Chief Campus Representative for East Campus—and both are intentional.
- **Committee directory:** Secretariat, Finance, Planning, Public Relations & Human Relations (PR-HR), and Ways and Means.
- **CBL reader:** in-page, multi-page PDF.js reader with separate-open and download fallbacks. The source PDF is `assets/BUOC_CBL_Clean.pdf`.
- **Concern & Inquiry Desk:** public submissions and private tracking; authorized officers can sign in through `officer.html`, review reports, update statuses, and reply. Backend services use Supabase; email notifications use the deployed `buoc-email-notifications` Edge Function and Resend.

## Maintained files

| Path | Purpose |
|---|---|
| `index.html` | Main public website, directories, CBL reader, and concern form |
| `officer.html` | Authenticated officer workspace |
| `assets/BUOC_CBL_Clean.pdf` | Published Constitution and By-Laws PDF |
| `assets/officers/` | Public officer portraits used by the directory |
| `assets/committee-logos/` | Committee artwork |
| `assets/concern-config.js` | Public Supabase URL and publishable/anon key only |
| `supabase/schema.sql` | Core database schema, policies, and RPCs |
| `supabase/migrations/` | Versioned database changes; retain these for change history and reproducibility |
| `supabase/functions/buoc-email-notifications/index.ts` | Durable queue, retry handling, and Resend delivery |
| `supabase/EMAIL_NOTIFICATIONS.md` | Email queue, webhook, Vault, scheduler, and recovery guide |
| `SETUP_CONCERN_SYSTEM.md` | Concern Desk architecture, setup, security, and launch checks |

SQL scripts under `supabase/` are operational database scripts, not disposable temporary files. Review what each does before running it; do not execute destructive maintenance scripts on production data without confirming the target and backup/retention policy.

## Configuration and security

- `assets/concern-config.js` is loaded by the public site and officer portal. It may contain only the Supabase project URL and public anon/publishable key.
- Never commit Supabase service-role keys, Resend API keys, webhook secrets, private credentials, or real concern records.
- Keep officer access limited to individually authenticated, currently authorized accounts. Maintain row-level security and a private attachment bucket.
- GitHub Pages is static hosting. Supabase configuration, database migrations, Edge Function deployment, Vault secrets, and scheduled queue draining are managed separately.

## Deployment and maintenance

1. Review the intended changes and preserve the existing asset paths and working website features.
2. Commit and push the public website changes to `main`.
3. Apply database migrations in the correct order in Supabase, deploy Edge Function changes separately, and manage secrets only in approved secret stores.
4. Test the welcome/navigation flow, committee profiles, officer profiles, all CBL pages on iOS and Android, and Concern Desk submission/tracking/officer workflows on desktop and mobile.
5. Check browser console, Supabase function logs, and Resend delivery logs after tests. A provider-accepted email is not by itself proof that it reached the recipient's inbox.

## Privacy and publication

The public site exposes its HTML and public assets. Publish officer names, portraits, organizational records, and the CBL only when BUOC has authority to publish them. Do not include sensitive information in public profiles or email subjects. Define a report retention period and remove old concerns/attachments according to BUOC policy and applicable privacy requirements.

The QR code should point to the live website URL; test it on multiple devices before printing or distributing it.
