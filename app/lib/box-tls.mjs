// Verschluesselter Weg zur Hetzner-Box (Sicherheitsdurchsicht 24.10.2026,
// klartext-token + netzbindung).
//
// refresh-api lief bis dahin nur ueber http://<Box>:4100 — das
// Bearer-Token ging im Klartext durchs Netz. Ein oeffentliches Zertifikat
// (Let's Encrypt fuer die IP ueber Caddy) wurde verworfen, weil dafuer fremde
// Software auf die Box muesste. Stattdessen: eigenes Zertifikat, auf der Box
// erzeugt, und jeder Aufrufer vertraut GENAU diesem (Pinning) — keine fremde
// Zertifizierungsstelle kann sich dazwischenschieben, keine 6-Tage-Erneuerung.
//
// Der private Schluessel liegt nur auf der Box
// (/etc/credstore/metastats-refresh-api-tls.key, per ImportCredential an den
// Dienst). Hier steht nur das oeffentliche Zertifikat. Der Dienst nimmt es von
// HIER und prueft beim Start, dass es zu seinem Schluessel passt — Zertifikat
// im Code und Schluessel auf der Box koennen also nicht still auseinanderlaufen.
//
// Seit 22.11.2026 steht im Zertifikat KEINE Adresse mehr, sondern der Name
// BOX_TLS_NAME (reservierte Endung .invalid, steht nie im DNS): das Repo ist
// oeffentlich, und ein Zertifikat mit der IP im Code verraet die Adresse.
// Verbunden wird weiter ueber die Adresse aus HETZNER_REFRESH_URL; geprueft
// wird deshalb nicht der Name, sondern der genaue Fingerabdruck
// (pinnedTlsOptions). Kette gegen `ca` bleibt zusaetzlich Pflicht.
//
// Zertifikatswechsel (Ablauf 21.11.2029 oder Verdacht auf Diebstahl):
//   1. neues Paar auf der Box erzeugen (Schluessel unter neuem Namen),
//   2. neues PEM HINTEN an BOX_TLS_CERTS anhaengen, ausrollen (Aufrufer
//      vertrauen beiden),
//   3. Schluessel auf der Box tauschen, Dienst neu starten,
//   4. altes PEM entfernen, ausrollen.
// Erzeugt mit (umask 077): openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1
//   -nodes -days 1095 -subj "/CN=box.invalid" -addext "subjectAltName=DNS:box.invalid"
//   -addext "basicConstraints=critical,CA:FALSE" -addext "keyUsage=critical,digitalSignature"
//   -addext "extendedKeyUsage=serverAuth"
//
// Als .mjs mit nur node:-Importen: Vercel-Routen, lokale Skripte, die
// GitHub-Action contracts-alert und die Box (Dienst + Laufzeit-Vertrag) nutzen
// dieselbe Datei. Steht deshalb im Pfad-Filter von
// .github/workflows/deploy-hetzner.yml. Nicht aus Client-Komponenten
// importieren (node:https).

import https from 'node:https';
import { X509Certificate } from 'node:crypto';

export const BOX_TLS_PORT = 8443;
export const BOX_TLS_NAME = 'box.invalid';

// sha256 6E:6D:4A:7E:56:BF:5C:38:CF:C2:C5:CA:49:6E:3C:94:EC:45:24:D9:C5:7D:BE:41:5F:A3:FF:27:EE:5D:DC:F4
// gueltig 24.10.2026 – 23.10.2029
export const BOX_TLS_CERTS = [
  `-----BEGIN CERTIFICATE-----
MIIBljCCATygAwIBAgIUO23oz6giJdeSEAKbhOrYLvcixUEwCgYIKoZIzj0EAwIw
GDEWMBQGA1UEAwwNMzcuMjcuMjE5LjE0MDAeFw0yNjEwMjQwNDM0MzFaFw0yOTEw
MjMwNDM0MzFaMBgxFjAUBgNVBAMMDTM3LjI3LjIxOS4xNDAwWTATBgcqhkjOPQIB
BggqhkjOPQMBBwNCAASLaxVlmtxeaZeqfMchu8Sj+DtQk5oI5pWtJ6K9t38W+WMN
U/KpQsi+ZGe30ECmvZYpulN7gUBpALVWmNVtwIN/o2QwYjAdBgNVHQ4EFgQUCmq9
/7UbVXy1e9lgx+SC1CcB3L4wHwYDVR0jBBgwFoAUCmq9/7UbVXy1e9lgx+SC1CcB
3L4wDwYDVR0TAQH/BAUwAwEB/zAPBgNVHREECDAGhwQlG9uMMAoGCCqGSM49BAMC
A0gAMEUCIQDV2CEMeWpM/43GyUCYmVtXHuR3z3KKwLpc7LcmEDyW5gIgApAwpQen
ygP63Fex2s55RRAkUlq6r9VFB9TWCb79AQo=
-----END CERTIFICATE-----
`,
  // sha256 95:03:26:9B:E3:EF:66:AC:2D:14:58:48:ED:5C:E7:28:7B:93:48:33:A7:55:60:F4:A4:2F:B0:FA:9D:D0:D2:F5
  // CN/SAN box.invalid, CA:FALSE, gueltig 22.11.2026 – 21.11.2029
  `-----BEGIN CERTIFICATE-----
MIIBvTCCAWOgAwIBAgIUPk+d8UodYEKZEY8fyjHiQWAzxRcwCgYIKoZIzj0EAwIw
FjEUMBIGA1UEAwwLYm94LmludmFsaWQwHhcNMjYxMTIyMjAwNjM5WhcNMjkxMTIx
MjAwNjM5WjAWMRQwEgYDVQQDDAtib3guaW52YWxpZDBZMBMGByqGSM49AgEGCCqG
SM49AwEHA0IABOsSvuiZEuHp+SyuOvwmrxxgbs8Rck4keYXTrn7VD9uFTx0QUTg3
MSmJyzPSqz9MrVs0T8CMPFGylOD3DC3ZfByjgY4wgYswHQYDVR0OBBYEFCUFTS8j
NinjIdT45D9UIz1GaiG8MB8GA1UdIwQYMBaAFCUFTS8jNinjIdT45D9UIz1GaiG8
MBYGA1UdEQQPMA2CC2JveC5pbnZhbGlkMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/
BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMAoGCCqGSM49BAMCA0gAMEUCIQDe
CSaWvl6OV7I6FOOiKBmdzFTGHQ9GONWOFPFw4eKn0QIgTjnL+246vB4KqWGueSpi
tC4EZnl48fAzH0kZvKj7ukc=
-----END CERTIFICATE-----
`,
];

/**
 * TLS-Optionen fuer jede Verbindung zur Box (boxAgent, Laufzeit-Vertrag).
 * Die Kette muss gegen `ca` aufgehen UND der Fingerabdruck des ausgelieferten
 * Zertifikats muss in `certs` stehen. Den Namen prueft Node damit nicht mehr —
 * verbunden wird ueber die Adresse, im Zertifikat steht nur BOX_TLS_NAME.
 * checkServerIdentity gibt einen Fehler ZURUECK (werfen wuerde den Prozess
 * beenden) und nennt keine Adresse.
 * @param {string[]} [certs]
 */
export function pinnedTlsOptions(certs = BOX_TLS_CERTS) {
  const pins = new Set(certs.map((pem) => new X509Certificate(pem).fingerprint256));
  return {
    ca: certs,
    checkServerIdentity(_host, cert) {
      if (cert?.fingerprint256 && pins.has(cert.fingerprint256)) return undefined;
      const err = new Error('Box-Zertifikat nicht gepinnt');
      err.code = 'ERR_BOX_TLS_NOT_PINNED';
      return err;
    },
  };
}

// Ein Verbindungs-Pool fuer alle Aufrufe des Prozesses: haelt die Verbindung
// offen (jeder neue Handshake kostet ab fra1 ~30 ms). Ruhende Verbindungen
// schliesst der Pool nach 4 s selbst — vor dem Dienst (10 s), damit keine
// Anfrage auf eine Verbindung trifft, die die Box gerade zumacht.
export const boxAgent = new https.Agent({ keepAlive: true, ...pinnedTlsOptions(), timeout: 4000 });

// Antworten ohne Inhalt; new Response() wirft, wenn man ihnen einen gibt.
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

function plainHeaders(h) {
  const out = {};
  if (!h) return out;
  new Headers(h).forEach((v, k) => { out[k] = v; });
  return out;
}

function requestOnce(url, init, agent) {
  const signal = init.signal;
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) return rejectPromise(signal.reason);
    let settled = false;
    const done = (fn, v) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      fn(v);
    };
    const req = https.request(url, {
      method: init.method || 'GET',
      headers: plainHeaders(init.headers),
      agent,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', (err) => done(rejectPromise, new TypeError('fetch failed', { cause: err })));
      res.on('end', () => {
        const status = res.statusCode || 0;
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
          else if (v != null) headers.set(k, String(v));
        }
        const body = NULL_BODY.has(status) ? null : Buffer.concat(chunks);
        done(resolvePromise, new Response(body, { status, statusText: res.statusMessage || '', headers }));
      });
    });
    // Wie fetch: Abbruch mit dem Grund des Signals (AbortSignal.timeout →
    // TimeoutError), auch noch waehrend die Antwort hereinkommt.
    function onAbort() {
      req.destroy(signal.reason);
      done(rejectPromise, signal.reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    // Wie fetch: Netzfehler als TypeError, der eigentliche Grund (z. B.
    // DEPTH_ZERO_SELF_SIGNED_CERT, ECONNREFUSED) in err.cause.
    req.on('error', (err) => {
      if (signal?.aborted) return done(rejectPromise, signal.reason);
      const e = new TypeError('fetch failed', { cause: err });
      e.reusedSocket = req.reusedSocket;
      done(rejectPromise, e);
    });
    if (init.body != null) req.write(init.body);
    req.end();
  });
}

/**
 * fetch-Ersatz fuer Aufrufe an die Box. https-Adressen gehen mit Pinning auf
 * BOX_TLS_CERTS, alles andere unveraendert an das eingebaute fetch (so laeuft
 * der Code auch, solange HETZNER_REFRESH_URL noch auf http steht).
 * Body nur als string/Buffer/Uint8Array. Die Antwort wird ganz gepuffert.
 * Trifft eine Anfrage auf eine gerade geschlossene Pool-Verbindung, wird sie
 * genau einmal wiederholt — ausser bei `retry: false` (schreibende Aufrufe).
 * @param {string | URL} url
 * @param {RequestInit & { retry?: boolean, agent?: import('node:https').Agent }} [init]
 * @returns {Promise<Response>}
 */
export async function boxFetch(url, init = {}) {
  const u = new URL(String(url));
  const { retry = true, agent = boxAgent, ...rest } = init;
  if (u.protocol !== 'https:') return fetch(String(url), rest);
  try {
    return await requestOnce(u, rest, agent);
  } catch (err) {
    if (retry && err?.reusedSocket && err.cause?.code === 'ECONNRESET' && !rest.signal?.aborted) {
      return requestOnce(u, rest, agent);
    }
    throw err;
  }
}
