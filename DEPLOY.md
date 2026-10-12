# Deploy to Render (about 15 minutes)

Result: `https://register.core2cloud.in` (or the subdomain you pick) with automatic https, a persistent disk for registrations, and the dashboard at `/admin`.

Cost: Render **Starter** web service, about US$7/month. A disk (needed so registrations survive restarts) is only available on paid plans, and 1 GB is plenty. See Render's pricing page for the current price.

## 1. Put the code on GitHub

This folder is already a git repository with one commit. Create an empty **private** repository on GitHub (name it e.g. `genai-workshop-registration`, do not add a README), then in this folder run:

```bash
git remote add origin https://github.com/YOUR-USERNAME/genai-workshop-registration.git
git push -u origin main
```

(GitHub will ask you to sign in the first time.)

## 2. Create the service on Render

1. Sign in at https://dashboard.render.com and choose **New > Blueprint**.
2. Connect your GitHub account and pick the repository. Render reads `render.yaml`.
3. It asks for **ADMIN_PASSWORD**. Type a strong password (this is your dashboard login) and keep it somewhere safe.
4. Click **Apply**. The first build takes a few minutes. When it says **Live**, open the `.onrender.com` address it shows and try a test registration.

## 3. Your own web address

1. In the service, open **Settings > Custom Domains > Add**, and enter `register.core2cloud.in` (or another subdomain).
2. Render shows a DNS record, normally a **CNAME** with name `register` and value `something.onrender.com`. Add exactly that at wherever core2cloud.in's DNS is managed (your domain registrar or DNS provider).
3. Back in Render click **Verify**. Https turns on by itself within a few minutes.

## 4. Check it works

- `https://YOUR-ADDRESS/` shows the registration page. Register once with your own details.
- `https://YOUR-ADDRESS/admin` asks for the password. Your test registration should be listed.
- Delete your test row from the CSV later, or set it to **Cancelled**.

## 5. Then

Use these links in Instagram (`src=` shows which channel brought each person):

- Bio: `https://YOUR-ADDRESS/?src=ig_bio`
- Story sticker: `https://YOUR-ADDRESS/?src=ig_story`
- WhatsApp groups: `https://YOUR-ADDRESS/?src=whatsapp`
- College coordinators: `https://YOUR-ADDRESS/?src=college&type=college_group`

Tell me the final address and I will add the QR code to the posters and update the captions.

## Notes

- **Backups:** the data is one file on the disk. Use **Export CSV** in the dashboard regularly. Render can also snapshot disks (Disks tab).
- **Updating the site:** change the code, `git push`, and Render redeploys. The disk keeps the registrations.
- **Turning payments on later:** in Render > Environment add `PAYMENTS=on`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and set the webhook URL in Razorpay to `https://YOUR-ADDRESS/api/razorpay/webhook`.
- Render's free plan cannot be used: it has no disk and sleeps when idle.
