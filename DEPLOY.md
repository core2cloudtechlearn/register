# Deploy for free: Render (website) + Turso (database)

Render's free plan has no disk and forgets files on every restart, so registrations live in a free **Turso** database instead. Both are free with no card (checked October 2026; confirm on their pricing pages).

## 1. Create the free database (Turso, about 5 minutes)

1. Sign up at https://turso.tech (GitHub or Google login).
2. Create a database, e.g. `workshop`, in the region nearest India.
3. Open it and copy the **database URL** (starts with `libsql://`).
4. Create a **token** for it (Generate Token, full access) and copy it. Keep it secret.

## 2. Deploy the website (Render)

1. Sign in at https://dashboard.render.com with **core2cloudtechlearn@gmail.com**.
2. **New > Blueprint**, connect GitHub, choose the `core2cloudtechlearn/register` repository.
3. Render shows three values to fill in:
   - `ADMIN_PASSWORD`: a strong password of your choice. This is your dashboard login.
   - `TURSO_URL`: the `libsql://...` address from step 1.
   - `TURSO_AUTH_TOKEN`: the token from step 1.
4. The plan shows **Free**. Click **Apply** and wait for **Live**.
5. Open the `.onrender.com` address, register once, then open `/admin` and sign in.

On start-up the server prints `Storage: Turso ...`. If the token or URL is wrong it stops with a clear message in the Render logs.

## 3. Keep it awake (important on the free plan)

Render's free service goes to sleep after 15 minutes without visitors, and the next visitor waits roughly a minute while it wakes. To avoid that for Instagram traffic, create a free monitor (for example at https://uptimerobot.com) that opens `https://YOUR-ADDRESS/api/config` every 5 minutes. One always-on free service fits inside Render's 750 free hours per month.

## 4. Your own address

In Render: Settings > Custom Domains > add `register.core2cloud.in`, then add the DNS record Render shows (usually a CNAME) where core2cloud.in's DNS is managed, then Verify. Https turns on by itself.

## 5. Then

Use these links on Instagram (`src=` shows which channel brought each person):

- Bio: `https://YOUR-ADDRESS/?src=ig_bio`
- Story sticker: `https://YOUR-ADDRESS/?src=ig_story`
- WhatsApp groups: `https://YOUR-ADDRESS/?src=whatsapp`
- College coordinators: `https://YOUR-ADDRESS/?src=college&type=college_group`

## Notes

- **Backups:** Turso keeps one day of point-in-time restore on the free plan. Also press **Export CSV** in the dashboard regularly.
- **Updating the site:** change the code, `git push`, Render redeploys. The data stays in Turso.
- **Payments later:** add `PAYMENTS=on` and the Razorpay variables in Render's Environment tab.
- **Paid alternative:** switching `plan: free` to `starter` and using a disk (see git history) removes the sleep and the need for Turso.
