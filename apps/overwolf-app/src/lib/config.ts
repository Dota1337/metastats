// Die HMAC-Kennung liegt auch als Vercel-Env OVERWOLF_APP_SECRET auf dem
// Server — beide muessen gleich bleiben.
//
// Kein echtes Geheimnis: das Paket ist oeffentlich, jeder kann es auslesen.
// Signatur + 5-Minuten-Fenster machen nur beilaeufiges Fluten teuer. Fuer echte
// Nutzer-Schluessel braeuchte es ein kurzlebiges Server-Token nach Overwolf-Login.
export const APP_SECRET = 'b1fb7ccb494629968f7f23cf4619de60bcca00abd9edaf01ec2104058966308e';

// Kanonischer Host: die Apex-Domain leitet per 307 auf www um, und
// CORS-Vorabanfragen duerfen nicht umgeleitet werden.
export const API_BASE = 'https://www.metastats.gg';

export const CLIENT_VERSION = '0.4.1';
