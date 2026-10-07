# Sending email with Brevo

[Brevo](https://www.brevo.com) (formerly Sendinblue) is an email service with a free tier that
works well for Mike's EZ Standup's invitations and password resets. Any other SMTP provider
works too; see "Email setup" in [README.md](README.md).

## 1. Get your SMTP details from Brevo

1. Sign in at https://app.brevo.com.
2. Go to **Settings > SMTP & API**, then the **SMTP** tab.
3. Note the **SMTP server** (`smtp-relay.brevo.com`), the **port** (587), and your **login**.
   The login is shown on that page; it may be an address ending in `@smtp-brevo.com` rather
   than your own email.
4. Choose **Generate a new SMTP key** and copy the key. Use this **SMTP key** as the
   password. It is not your Brevo password, and not an API key (API keys start with
   `xkeysib-`; SMTP keys usually start with `xsmtpsib-`).

## 2. Make sure your "from" address is allowed

Brevo only sends from senders you have verified. Under **Senders, Domains & Dedicated IPs**:

- **Senders:** use an address listed (and verified) there as your `from` address.
- **Domains:** if your domain shows as authenticated, your emails are much less likely to land
  in spam. Avoid using a Gmail, Outlook or Yahoo address as the sender; those providers often
  reject mail sent on their behalf by other services.

## 3. Add the settings to config/config.json

Replace the `smtp` entry with:

```json
"smtp": {
  "host": "smtp-relay.brevo.com",
  "port": 587,
  "secure": false,
  "user": "your-smtp-login@smtp-brevo.com",
  "pass": "xsmtpsib-your-smtp-key",
  "from": "Mike's EZ Standup <standup@yourdomain.com>"
}
```

Keep only **one** `"smtp"` entry in the file (the installer may have left `"smtp": null`;
replace it rather than adding a second one). Then restart the server.

## 4. Test it

```
node install/test-email.js you@yourdomain.com
```

If it says "Sent" but the email doesn't arrive, check your spam folder, then Brevo's
**Transactional > Email > Logs** page: it shows whether each message was delivered, and the
reason if it wasn't. If port 587 is blocked on your network, try port 2525.
