// Passwoerter mit Sonderzeichen brechen den URL-Parser von pg — das Passwort
// wird deshalb einmal sauber kodiert (bereits kodierte bleiben gleich).
export function encodePasswordInPgUrl(url) {
  const schemeEnd = url.indexOf('://');
  if (schemeEnd < 0) return url;
  const after = url.slice(schemeEnd + 3);
  const atIdx = after.lastIndexOf('@');
  if (atIdx < 0) return url;
  const userinfo = after.slice(0, atIdx);
  const colon = userinfo.indexOf(':');
  if (colon < 0) return url;
  const user = userinfo.slice(0, colon);
  const pass = userinfo.slice(colon + 1);
  let decoded = pass;
  try { decoded = decodeURIComponent(pass); } catch { /* roh lassen */ }
  return `${url.slice(0, schemeEnd + 3)}${user}:${encodeURIComponent(decoded)}@${after.slice(atIdx + 1)}`;
}
