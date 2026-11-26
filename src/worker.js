// VLESS over WebSocket on Cloudflare Workers.
// The censor sees ordinary HTTPS to Cloudflare's edge; the VLESS protocol
// rides inside the WebSocket, and the Worker opens the real TCP connection
// to the destination with the cloudflare:sockets API.
//
// Deploy: npx wrangler deploy   (set UUID in wrangler.toml)
// Client: VLESS + WebSocket + TLS, path "/" , transport ws, tls on port 443.

import { connect } from 'cloudflare:sockets';

const HELP_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Mikan Edge</title></head>
<body style="font-family:sans-serif;background:#0b1020;color:#dbe4ff;text-align:center;padding-top:15vh">
<h1>It works</h1><p>This Cloudflare Worker carries an encrypted VLESS tunnel over WebSocket.</p></body></html>`;

export default {
  async fetch(request, env) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response(HELP_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    const pair = new WebSocketPair();
    handleVless(pair[1], (env && env.UUID ? String(env.UUID) : '').trim());
    return new Response(null, { status: 101, webSocket: pair[0] });
  },
};

async function handleVless(ws, expectedUuid) {
  ws.accept();
  const first = await new Promise((resolve) => {
    ws.addEventListener('message', (e) => resolve(new Uint8Array(e.data)), { once: true });
  }).catch(() => null);
  if (!first || first.length < 20) return close(ws);

  const req = parseRequest(first, expectedUuid);
  if (!req) return close(ws);

  if (req.command === 1) return relayTcp(ws, req);
  if (req.command === 2) return relayUdpDns(ws, req);
  return close(ws);
}

function parseRequest(buf, expectedUuid) {
  let p = 0;
  p += 1; // version
  const uuid = [...buf.slice(p, p + 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expectedUuid && uuid !== expectedUuid.replaceAll('-', '')) return null;
  p += 16;
  p += 1 + buf[p]; // addon length + addon
  const command = buf[p]; p += 1;
  const port = (buf[p] << 8) | buf[p + 1]; p += 2;
  const type = buf[p]; p += 1;
  let host;
  if (type === 1) { host = [...buf.slice(p, p + 4)].join('.'); p += 4; }
  else if (type === 2) {
    const len = buf[p]; p += 1;
    host = new TextDecoder().decode(buf.slice(p, p + len)); p += len;
  } else if (type === 3) {
    const octets = [];
    for (let i = 0; i < 8; i++) octets.push(((buf[p + i] << 8) | buf[p + i + 1]).toString(16));
    host = octets.join(':'); p += 16;
  } else return null;
  return { command, port, host, rest: buf.slice(p) };
}

function relayTcp(ws, req) {
  let socket;
  try {
    socket = connect({ hostname: req.host, port: req.port });
  } catch { return close(ws); }
  socket.opened.catch(() => close(ws));
  const writer = socket.writable.getWriter();

  ws.send(new Uint8Array([0, 0])); // VLESS response header
  (async () => {
    try {
      if (req.rest.length) await writer.write(req.rest);
      for (;;) {
        const { value, done } = await socket.readable.getReader().read();
        if (done) break;
        ws.send(value);
      }
    } catch { /* closed */ }
    close(ws);
  })();

  ws.addEventListener('message', async (e) => {
    try { await writer.write(new Uint8Array(e.data)); } catch { close(ws); }
  });
  ws.addEventListener('close', () => { try { socket.close(); } catch {} });
}

// Workers have no UDP sockets. VLESS command 2 in practice is only used for
// DNS, and DNS over TCP to a public resolver on port 53 is equivalent.
function relayUdpDns(ws, req) {
  let socket;
  try {
    socket = connect({ hostname: '1.1.1.1', port: 53 });
  } catch { return close(ws); }
  socket.accepted?.catch(() => {});
  const writer = socket.writable.getWriter();

  ws.send(new Uint8Array([0, 0]));
  (async () => {
    for (;;) {
      const { value, done } = await socket.readable.getReader().read();
      if (done) break;
      // strip the TCP-DNS 2-byte length prefix, send raw UDP-style packet
      const n = (value[0] << 8) | value[1];
      ws.send(value.slice(2, 2 + n));
    }
  })();
  ws.addEventListener('message', async (e) => {
    try {
      const q = new Uint8Array(e.data);
      const framed = new Uint8Array(q.length + 2);
      framed[0] = q.length >> 8; framed[1] = q.length;
      framed.set(q, 2);
      await writer.write(framed);
    } catch { /* ignore */ }
  });
  ws.addEventListener('close', () => { try { socket.close(); } catch {} });
}

function close(ws) {
  try { ws.close(1008); } catch {}
  return true;
}