# Testing on separate devices

Run Docker Desktop, then from the repository root:

```powershell
docker compose -f docker/docker-compose.yml up -d --build
docker compose -f docker/docker-compose.yml exec nginx nginx -t
docker compose -f docker/docker-compose.yml restart nginx
.\cloudflared.exe tunnel --url https://localhost:443 --no-tls-verify
```

Use the printed HTTPS URL with the same `?room=<random-room-name>` on both
devices. Close old tabs in that room first (two users maximum). The public
certificate works on phones without installing your local development CA.
The no-tls-verify option is only for the tunnel's connection to local Nginx.
Keep the laptop awake, Docker running, and the tunnel process running.
Stop the tunnel with Ctrl+C. A new launch generates a different public hostname.
This is a public development demo with no user authentication; share the URL
and room only with your tester.

## Public TURN relay

The tunnel carries HTTPS and WebSocket signaling, not the local coturn relay.
Without a reachable public TURN server, some network combinations will fail.

Create test credentials with a managed TURN service, for example following
https://www.metered.ca/docs/turn-server-service/creating-turn-credentials/ .
Copy client/runtime-config.example.js to client/runtime-config.js and replace
the example entries with the provider's exact ICE server URLs, username and
credential (including the provided TLS/TCP option). Do not use an account API key.
Reload both browsers. The config is mounted directly; no image rebuild needed.
It is intentionally Git-ignored but visible to browsers. Use limited/expiring
test credentials; production needs authenticated, server-issued credentials.

## Verification

1. Exchange chat on laptop Wi-Fi and phone Wi-Fi.
2. Disable phone Wi-Fi and repeat on cellular data.
3. Set WEBRTC_FORCE_RELAY to true in runtime-config.js, reload both browsers,
   and repeat. Successful chat now confirms TURN is carrying the connection.
4. Check voice, video, rejection and hangup; chat should remain available.
5. Restore WEBRTC_FORCE_RELAY to false and reload to allow direct routes again.

Local browser tests alone do not confirm cellular connectivity. If the page loads
but chat does not connect, check provider credentials and relay availability.
