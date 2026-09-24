#!/usr/bin/env bash
# Read-only smoke test for a running dashboard server (default :7500).
# Never mutates rigs, seats or the queue: mutation probes use a foreign Origin
# or a bad identifier and must be rejected before reaching the daemon.
# NOTE: file watching does not work on /mnt/c under WSL — restart the server
# after code changes, otherwise this tests stale code.
set -u
PORT="${PORT:-7500}"
HOSTPORT="127.0.0.1:$PORT"
B="http://$HOSTPORT/dash"
EXPECTED=12
passes=0
fail=0
ok() { echo "PASS  $1"; passes=$((passes + 1)); }
bad() { echo "FAIL  $1"; fail=1; }
code() { curl -s -m 8 -o /dev/null -w '%{http_code}' "$@"; }

# 1. Bind host: must listen on loopback only.
bind=$(ss -ltn "sport = :$PORT" | awk 'NR>1 {print $4}')
[ "$bind" = "$HOSTPORT" ] && ok "binds loopback only ($bind)" || bad "binds '$bind' (expected $HOSTPORT)"

# 2. Read endpoints return the contract shapes.
curl -sf -m 8 "$B/fleet" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert isinstance(d,list) and all("seats" in r for r in d)' \
  && ok "GET /fleet is Rig[]" || bad "GET /fleet shape"
curl -sf -m 8 "$B/needs-you" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert all(i["session"] for i in d["items"]) and "unresolved" in d' \
  && ok "GET /needs-you items all have a session" || bad "GET /needs-you shape"
curl -sf -m 8 "$B/queue?activeOnly=1&limit=5" | python3 -c 'import json,sys; assert "items" in json.load(sys.stdin)' \
  && ok "GET /queue" || bad "GET /queue shape"

# 3. Foreign Host (DNS rebinding) is refused, even for reads.
c=$(code -H "Host: evil.example:$PORT" "$B/fleet")
[ "$c" = 403 ] && ok "foreign Host read -> 403" || bad "foreign Host read -> $c"

# 4. Mutations from a foreign or missing Origin are refused.
c=$(code -X POST -H 'Origin: http://evil.example' -H 'content-type: application/json' -d '{"text":"x"}' "$B/seats/does-not-exist/send")
[ "$c" = 403 ] && ok "foreign Origin mutation -> 403" || bad "foreign Origin mutation -> $c"
c=$(code -X POST -H 'content-type: application/json' -d '{"text":"x"}' "$B/seats/does-not-exist/send")
[ "$c" = 403 ] && ok "missing Origin mutation -> 403" || bad "missing Origin mutation -> $c"

# 5. Invalid identifiers are rejected, not forwarded to the daemon.
c=$(code "$B/seats/..%2F..%2Fapi%2Fps/output")
[ "$c" = 400 ] && ok "traversal session id -> 400" || bad "traversal session id -> $c"
c=$(code "$B/queue?limit=abc")
[ "$c" = 400 ] && ok "invalid queue limit -> 400" || bad "invalid queue limit -> $c"

# 6. Terminal WS (read-only: sends no frames to real seats).
c=$(code -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: c21va2V0ZXN0a2V5MTIzNA==' -H 'Origin: http://evil.example' "$B/terminal/does-not-exist")
[ "$c" = 403 ] && ok "WS upgrade with foreign origin -> 403" || bad "WS upgrade with foreign origin -> $c"

first=$(curl -sf -m 8 "$B/needs-you" | python3 -c 'import json,sys; i=json.load(sys.stdin)["items"]; print(i[0]["session"] if i else "")')
ws_out=$(node -e '
  const [port, s] = process.argv.slice(1)
  const open = (session) => new WebSocket(`ws://127.0.0.1:${port}/dash/terminal/${encodeURIComponent(session)}`,
    { headers: { Origin: "http://127.0.0.1:5173" } })
  const streams = (session) => new Promise((res) => {
    const ws = open(session); let bytes = 0
    ws.onmessage = (e) => { bytes += String(e.data).length }
    ws.onerror = () => {}
    setTimeout(() => { ws.close(); res(bytes) }, 3000)
  })
  const closes = (session) => new Promise((res) => {
    const ws = open(session)
    ws.onerror = () => {}
    ws.onclose = (e) => res(e.code)
    setTimeout(() => { ws.close(); res("still-open") }, 5000)
  })
  ;(async () => {
    if (s) {
      const b = await streams(s)
      console.log(b > 0 ? `PASS  WS needs-you session ${s} streams ${b}b` : `FAIL  WS needs-you session ${s} streamed nothing`)
    } else console.log("SKIP  no needs-you item to open a terminal for")
    const c = await closes("zz-nope-smoke@dashtest")
    console.log(c !== "still-open" ? `PASS  WS nonexistent session -> client closed (${c})` : "FAIL  WS nonexistent session left client open")
  })().catch((e) => console.log(`FAIL  WS probe crashed: ${e.message}`))' "$PORT" "$first" 2>&1)
echo "$ws_out"
passes=$((passes + $(grep -c '^PASS' <<<"$ws_out")))
grep -q '^FAIL' <<<"$ws_out" && fail=1
grep -q '^SKIP' <<<"$ws_out" && EXPECTED=$((EXPECTED - 1))

echo "---- $passes/$EXPECTED passed"
[ "$passes" -eq "$EXPECTED" ] || fail=1
exit $fail
