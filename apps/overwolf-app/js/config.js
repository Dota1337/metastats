// Companion-app config. The HMAC secret is also stored on the server as
// the Vercel env `OVERWOLF_APP_SECRET` — they must stay in sync.
//
// SECURITY NOTE: The Overwolf bundle is openly distributed, so this
// secret isn't a true secret in the cryptographic sense — anyone who
// downloads the OPK can extract it. The HMAC + timestamp window is
// purely an anti-abuse gate that makes casual replay/spam expensive,
// not a key-management story. If we ever need a real per-user secret,
// the right move is a server-issued, short-lived token after OAuth
// against the user's Overwolf account.

window.METASTATS_CONFIG = {
  appSecret: 'b1fb7ccb494629968f7f23cf4619de60bcca00abd9edaf01ec2104058966308e',
  apiBase: 'https://metastats.gg',
};
