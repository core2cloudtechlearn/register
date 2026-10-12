# GenAI Workshop: Registration Site + Dashboard

Public registration page (`/`) and password-protected dashboard (`/admin`) for the 17-19 Oct 2026 workshop.
No npm packages to install. Needs **Node 22.5 or newer** (uses built-in SQLite). Data is one file: `data/registrations.db`.

## Run it on your PC (test)

```bash
ADMIN_PASSWORD="choose-a-strong-one" UPI_ID="yourname@bank" node server.js
```

On Windows PowerShell:

```powershell
$env:ADMIN_PASSWORD="choose-a-strong-one"; $env:UPI_ID="yourname@bank"; node server.js
```

- Registration: http://localhost:3000/
- Dashboard: http://localhost:3000/admin

## Current mode: registration only (payments off)

Payments are **off by default**. People register, see their reference and fee, and you send the payment link and joining details on **WhatsApp** from the dashboard:

1. Open `/admin`, expand **WhatsApp message & payment links**, and paste your Razorpay Payment Links (Razorpay Dashboard > Payment Links) for professionals and students. Edit the message if you like. It is saved in your browser.
2. Click **Send on WhatsApp** on a row. WhatsApp opens with the message filled in, and the person moves to **WhatsApp sent**.
3. When the money arrives, set the status to **Paid** (use the dropdown on the row).

College groups pay per student, so paste the exact group link into the message by hand. Existing users get a "your seat is free" message.

To switch on automatic online payment later, set `PAYMENTS=on` (plus the Razorpay keys below). Optional `WHATSAPP_NUMBER=919876543210` adds a "Message us on WhatsApp" button on the confirmation screen.

## Easiest way to run locally (uses a .env file)

1. Copy `.env.example` to `.env` and fill it in (your Razorpay **test** keys, an admin password).
2. Run `npm run dev` (or `node --env-file=.env server.js`).

`.env` is ignored by git and never served by the website.

## Settings (environment variables)

| Variable | Required | Meaning |
|---|---|---|
| `ADMIN_PASSWORD` | yes | Dashboard password. The server will not start without it. |
| `RAZORPAY_KEY_ID` | for online payment | Razorpay key id (`rzp_test_...` or `rzp_live_...`). |
| `RAZORPAY_KEY_SECRET` | for online payment | Razorpay key secret. Keep it only on the server. |
| `RAZORPAY_WEBHOOK_SECRET` | recommended | Secret you set on the Razorpay webhook (see below). |
| `UPI_ID` | manual UPI | Shown as a fallback, or as the only method if Razorpay is off. |
| `UPI_NAME` | no | Name shown in the UPI app (default Core2CloudX). |
| `PORT` | no | Default 3000. |
| `DB_PATH` | no | Where the database file lives. On a host, point this at a **persistent disk**. |

Prices live at the top of `server.js` (`WORKSHOP.categories`). The server sets the amount itself, so nobody can change a price from the browser. College groups pay price x number of students.

## Razorpay setup (online payment)

1. Create a Razorpay account and finish KYC (Razorpay Dashboard).
2. **Start in Test Mode.** Settings > API Keys > generate a test key. Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` and restart. The server log says `Razorpay: ON (test mode)`.
3. Register once on your site and pay with Razorpay's test UPI/card details (shown in their docs). The registration should turn **Paid** on the dashboard by itself.
4. **Add the webhook** (this catches people who pay but close the browser before it confirms): Razorpay Dashboard > Settings > Webhooks > Add. URL `https://YOUR-SITE/api/razorpay/webhook`, choose a secret, tick `payment.captured` (and `order.paid`), save. Put the same secret in `RAZORPAY_WEBHOOK_SECRET`.
5. When happy, generate **live** keys, replace the two key variables, and redeploy. The log then says `LIVE mode`.

How it stays safe:
- The server creates each Razorpay order with the amount it calculated, never one from the browser.
- A payment is only accepted after the server checks Razorpay's signature with your secret, and the amount matches.
- The payment is confirmed twice over (browser confirmation and webhook). Doing it twice is harmless.
- The key secret never reaches the browser.

If Razorpay keys are not set, the site falls back to the manual UPI flow (pay to your UPI ID, paste the transaction ID, you mark it Paid). When Razorpay is on, the manual UPI option stays available as a small "Prefer to pay to a UPI ID directly?" fold-out if `UPI_ID` is set.

Razorpay charges a fee per payment (check your plan in their dashboard). The site shows the full price and you absorb the fee.

## Testing payments without real keys

`test/mock_razorpay.js` is a stand-in for the Razorpay API:

```bash
node test/mock_razorpay.js
RAZORPAY_API_BASE=http://localhost:3200 RAZORPAY_KEY_ID=rzp_test_mockkey RAZORPAY_KEY_SECRET=mocksecret RAZORPAY_WEBHOOK_SECRET=whsecret ADMIN_PASSWORD=x node server.js
```

It only checks the server side (order creation, signature check, webhook). Real card or UPI payments need Razorpay's own test mode with your test keys.

## Put it online (so Instagram visitors can use it)

You need a host that runs Node and has a **persistent disk** (otherwise the database is wiped on every restart). Razorpay needs a public https address for the webhook.

- **Render / Railway / Fly.io:** create a service from this folder (it has a `Dockerfile` and `package.json`), set the variables above, attach a disk mounted at `/data`, and keep `DB_PATH=/data/registrations.db`. The host gives you an https address; add your own domain later.
- **A VPS:** `node server.js` behind Caddy or nginx for https, kept alive with pm2 or systemd.

Use https: the dashboard login cookie is only marked `Secure` when the proxy sends `X-Forwarded-Proto: https`.

## Links to put in your Instagram posts

The page records where each registration came from through `?src=`. Use a different one per place:

- Bio link: `https://YOUR-SITE/?src=ig_bio`
- Story link sticker: `https://YOUR-SITE/?src=ig_story`
- WhatsApp groups: `https://YOUR-SITE/?src=whatsapp`
- College coordinators: `https://YOUR-SITE/?src=college&type=college_group` (`type=` preselects `professional`, `student`, `college_group` or `existing`)

The dashboard's "By source" chart then shows which channel is working.

## Running the dashboard day to day

1. Open `/admin`, sign in. It refreshes every 30 seconds.
2. Razorpay payments turn **Paid** automatically, with the Razorpay payment ID and method in the Payment ID column.
3. Manual UPI payers show **Txn submitted**. Match the ID in your bank app, then set **Paid**.
4. **Existing users** arrive as **Verify user**. Check their earlier account, then set **Free (verified)**.
5. **Export CSV** gives the full list (with payment IDs and paid time) for sending joining links or certificates.

Statuses: Awaiting payment, Txn submitted, Paid, Verify user, Free (verified), Cancelled.

## Not included yet

- Automatic confirmation emails or WhatsApp messages.
- Refunds from the dashboard. Refund in the Razorpay Dashboard, then set the registration to Cancelled here.
- GST invoices.
- Seat limit and offer end date (not set yet).

## Backups

Copy `data/registrations.db` (or export the CSV) regularly.
