# Mikan Edge — VLESS over WebSocket on Cloudflare Workers

A DPI-resistant proxy that runs entirely on Cloudflare's edge (free plan works).
The censor in Iran sees only ordinary HTTPS traffic to a Cloudflare IP — the same
protection family as Xray/Reality (which the original Mikan panel runs on a real
server), adapted to what Cloudflare Workers can do: **VLESS over WebSocket+TLS**.

## What's here

- `src/worker.js` — the whole proxy in one file (VLESS parser, TCP relay, DNS relay)
- `wrangler.toml` — config; change `UUID` to your own before deploying
- `test/client.mjs` — end-to-end test (speaks real VLESS through the tunnel)

## Deploy (about 2 minutes)

1. Sign in: `npx wrangler login` (or set `CLOUDFLARE_API_TOKEN`).
2. Edit `wrangler.toml` → set `UUID` to a fresh UUID (any uuid generator).
3. `npx wrangler deploy`
4. You get `https://mikan-edge.<your-subdomain>.workers.dev`.

## Use on your phone / PC (daily driver)

In v2rayNG (Android), Streisand or Shadowrocket (iOS), or v2rayN (Windows),
add a VLESS server:

| Field    | Value |
|----------|-------|
| Address  | your workers.dev host (or a custom domain on Cloudflare) |
| Port     | 443 |
| UUID     | the UUID from wrangler.toml |
| Flow     | *(empty)* |
| Encryption | none |
| Transport| WebSocket (ws) |
| Path     | `/` |
| TLS      | enabled (tls) |
| SNI / Host | same as address |

Tip: attach your own domain to the Worker (Cloudflare dashboard → Workers →
your worker → Domains). Iranian ISPs sometimes throttle `*.workers.dev`
specifically; a normal-looking domain survives much better.

## Test locally

```
npm install
npx wrangler dev --port 8787 &
node test/client.mjs 8787
```

Expected: `TEST PASS: got 200 + Example Domain over the tunnel`.

## Notes & limits

- Workers have no UDP, so the VLESS UDP path is handled as DNS-over-TCP to
  1.1.1.1 (clients' built-in DNS works; you can also just enable "remote DNS"
  in the client app).
- No Reality: Reality needs raw TCP sockets on the server side, which Workers
  cannot provide. WebSocket+TLS on Cloudflare is the standard equivalent and is
  already tunnelled inside Iran's allowed Cloudflare traffic.
- Keep the UUID secret; anyone with it can use your Worker as an open proxy.
