# OpenRig daemon: dashboard-API-inventaris

Status: discovery, 2026-09-24. Inventaris van de geïnstalleerde OpenRig CLI/daemon (`/usr/lib/node_modules/@openrig/cli/daemon/dist`). Er zijn geen muterende requests gedaan.

## Runtime-probe en beperking

De opgegeven lokale daemon was niet bereikbaar. Deze uitsluitend-GET probe is werkelijk uitgevoerd:

```console
$ curl --max-time 8 --silent --show-error --include http://127.0.0.1:7433/api/ps
curl: (7) Failed to connect to 127.0.0.1 port 7433 after 0 ms: Couldn't connect to server
```

Dezelfde `connection refused` gold voor `GET /healthz`, `/api/rigs`, `/api/rigs/summary`, `/api/sessions`, `/api/activity` en `/api/queue`. Daarom bestaan hier geen eerlijke live JSON-voorbeelden. De JSON-blokken hieronder zijn bron-afgeleide vormvoorbeelden (geen vast schema, geen gefingeerde curl-uitvoer). Herhaal de GET-calls wanneer de daemon weer luistert en vervang ze door gesaneerde echte responsen.

Basis-URL: `http://127.0.0.1:7433`. De meeste reads zijn open; terminal-WebSocket, transport en previews zijn bearer-beschermd zodra een terminaltoken bestaat.

## Fleet en rigs

### `GET /api/ps`

Opties: `?includeArchived=true` of `?archived=only`. Array, standaard zonder gearchiveerde rigs.

```json
[{"rigId":"…","name":"dashboard-team","rigName":"dashboard-team","nodeCount":3,"runningCount":2,"activeCount":1,"hasWorkCount":2,"attentionCount":0,"status":"partial","lifecycleState":"degraded","uptime":"12m","latestSnapshot":"4m","archivedAt":null,"isArchived":false,"periodicSnapshotActive":false,"periodicSnapshotIntervalSeconds":0,"autoPeriodicSnapshotCount":0}]
```

UI: `rigId`, `name`, counts, `status`, `lifecycleState`, `isArchived`; `uptime` en `latestSnapshot` zijn displaystrings, niet datumwaarden.

### `GET /api/rigs` en `GET /api/rigs/summary`

`/api/rigs` geeft opgeslagen rig-objecten. `/summary` is de dashboard-roll-up met `lifecycleState` en `hasLiveAgents`; beide kennen de archiefquery's. Haal voor een detail `GET /api/rigs/:rigId` op, en voor een topologie `GET /api/rigs/:rigId/graph`.

```json
[{"id":"…","name":"dashboard-team","archivedAt":null,"lifecycleState":"running","hasLiveAgents":true}]
```

UI: `id` als routeparameter, `name`, archiefstatus en de summary-velden. Extra opgeslagen rig-velden zijn extensies.

### `GET /api/rigs/:rigId/sessions`

Geeft de raw sessieregistry-array; lichter dan nodes maar zonder samengevoegde activiteit, queue en context.

```json
[{"id":"…","nodeId":"…","sessionName":"dev-codexdev@dashboard-team","status":"running","startupStatus":"ready"}]
```

UI: gebruik `sessionName` als terminal-/transcript-target, maar gebruik `/nodes` voor het hoofdroster.

### `GET /api/rigs/:rigId/nodes[?refresh=true&full=true]`

Primaire roster-read. `refresh=true` doet vooraf een contextmonitor-poll; `full=true` vraagt duurdere activity-capture. Het zijn GETs, maar dus niet noodzakelijk goedkoop/passief. `404` voor onbekende rig, `502` als gevraagde refresh faalt.

```json
[{"nodeId":"…","rigId":"…","rigName":"dashboard-team","logicalId":"dev.codexdev","podId":"…","podNamespace":"dev","role":null,"canonicalSessionName":"dev-codexdev@dashboard-team","attachmentType":"tmux","nodeKind":"agent","runtime":"codex","sessionStatus":"running","startupStatus":"ready","restoreOutcome":"n-a","oriented":"verified","lifecycleState":"running","occupantLifecycle":"active","continuityOutcome":null,"latestError":null,"model":null,"cwd":"/mnt/c/CODING/openrig-dashboard","contextUsage":{"availability":"known","usedPercentage":21,"fresh":true},"agentActivity":{"state":"idle"},"terminalActive":false,"lastActivityAt":"2026-09-24T13:00:00.000Z","hasAssignedWork":true,"assignedWorkCount":1,"pendingWorkCount":1,"inProgressWorkCount":0,"blockedWorkCount":0,"hostSelfId":"…"}]
```

UI-kern: identiteit (`nodeId`, `logicalId`, `podNamespace`, `runtime`, `nodeKind`, `canonicalSessionName`), toestand (`sessionStatus`, `startupStatus`, `lifecycleState`, `agentActivity`, `terminalActive`, `latestError`), continuïteit (`restoreOutcome`, `oriented`, `identityVerdict`, `heldReason`) en werk (boolean plus counts). Context kan onbekend/stale zijn. `resumeToken` zit in de huidige projection: niet tonen of client-side opslaan.

### `GET /api/rigs/:rigId/nodes/:logicalId`

Uitgebreid node-detail; `404` voor onbekende rig/node. Voegt o.a. `binding`, `startupFiles`, `startupActions`, `projectionEntries`, `installedResources`, recente `events`, `recoveryGuidance`, `permissionDrift`, maximaal drie `currentQitems` en (indien ingeschakeld) `transcript` toe. Alleen laden bij een geopende detaildrawer.

### `GET /api/sessions/:sessionName/preview?lines=N`

Read-only terminal-preview. Bij terminaltoken: `Authorization: Bearer …`. Een kale `GET /api/sessions` is niet geregistreerd en geeft 404.

## Live updates (SSE)

### `GET /api/events[?rigId=:rigId]`

SSE, geen eindigend JSON-antwoord. Ondersteunt `Last-Event-ID`; de server replayt gemiste opgeslagen events en gaat daarna zonder gat naar live. `id` is de monotonische event-sequentie.

```text
id: 1842
data: {"seq":1842,"type":"queue.created","rigId":"…",…}
```

UI: bewaar het laatste id voor reconnect en rehydrateer relevante read-modellen na events.

### `GET /api/activity/events`

SSE-invalidatiesignalen: `seat.activity_changed`, `seat.rung_health`, `proof.judged`, `proof.sources_changed`. `data` is het event JSON; laad `/api/ps` of `/nodes` opnieuw in plaats van zelf activity-state af te leiden. Kan `503 activity_events_unconfigured` geven.

```text
event: seat.activity_changed
data: {"type":"seat.activity_changed","nodeId":"…","sessionName":"…","seq":1843,…}
```

### `GET /api/activity/parked?rig=:rigName[&seat=:session]`

Read-only diagnose voor geparkeerde seats. Vereist rigscope via `rig`, een `seat` met `@rig`, of `X-OpenRig-Session`; anders `400 rig_scope_unresolvable`. Voor troubleshooting, niet de normale pollinglus. Er is geen kale `GET /api/activity`.

## Queue

### `GET /api/queue/list`

Query's: `destinationSession`, `sourceSession`, `state` (kommagescheiden), `targetRepo`, `limit`, `as`, `compact=1`, `rig`, `activeOnly=1`, `attention=1`. Antwoord: array qitems; attention beperkt automatisch tot open states.

```json
[{"qitemId":"qitem-…","sourceSession":"orch-lead@dashboard-team","destinationSession":"dev-codexdev@dashboard-team","body":"…","state":"in-progress","tier":"normal","tsCreated":"…","tsUpdated":"…"}]
```

UI: `qitemId`, bron/bestemming, `body`/`summary`, `state`, `tier`, timestamps, `blockedOn` en closure/deadlinevelden als aanwezig. Gebruik `compact=1` in lange lijsten.

Andere reads: `GET /api/queue/:qitemId`, `/:qitemId/transitions`, `/whoami?session=…`, `/attention-aggregate`, `/human-updates?limit=20`, `/overdue`, `/undelivered`, `/recent-transitions?rig=…` (of `scope=instance`), `/inbox/pending`, `/inbox/list`, `/outbox/list`. `GET /api/queue/sse` (legacy `/watch`) is SSE voor queue-events, zonder replay: herlaad `/list` na reconnect.

## Transcripten

### `GET /api/transcripts/:session/tail?lines=50`

```json
{"session":"dev-codexdev@dashboard-team","lines":50,"content":"…","ingestHealth":{"state":"live","runtime":"codex"}}
```

Ook: `GET /:session/grep?pattern=…` geeft `matches`; `GET /:session/full` geeft `content`. De full-route redigeert credential-achtige tekst vóór serialisatie. `404` betekent uitgeschakeld/onbekend; `503` betekent gedegradeerde of lege capture. Toon `ingestHealth`: lege tekst is geen bewijs van stilte.

## Terminal en transport (muterende routes; niet aangeroepen)

### `POST /api/transport/send`

Minimaal `{ "session": "…", "text": "…" }`; aanvullend o.a. `verify`, `force`, `waitForIdleMs`, `dangerouslyInteract`, `reason`, `submitOnly`. `X-OpenRig-Session` is de afzenderbron; zonder header wordt bezorgd met een waarschuwing dat de ontvanger geen afzender kent. Fouten: `400`, `404`, `409`, `502`, `503`. Achter `rig send`.

### `POST /api/transport/capture`

`{ "session": "…", "lines": 50 }`, of multi-target `{ "rig": "…", "lines": 50 }` / `{ "pod": "…", "rig": "…", "lines": 50 }`. Succes is de capture-response of `{ "results": [...] }`. Achter `rig capture`. Hoewel het leest is het POST en is het dus niet gebruikt in deze discovery.

Beide `/api/transport/*` routes gebruiken terminal-bearer-auth wanneer een token bestaat.

## Terminal-WebSocket: `GET /api/terminal/:sessionName` met Upgrade

Alleen geregistreerd met Node WebSocket-support. URL-encodeer `sessionName` (bijv. `dev-codexdev%40dashboard-team`). Viewers delen één daemonbroker/tmux-pipe. Server → client is **ruwe terminaltekst/ANSI**, geen JSON.

Client → server zijn JSON-tekstframes:

```json
{"type":"keys","keys":["Enter"]}
{"type":"text","text":"hello"}
{"type":"scroll","offset":30}
```

`scroll.offset` telt regels boven live onderkant; `0` is live. Malformeerde/ongekende frames worden genegeerd. Maximaal 32 vroege frames of 256 KiB wachten op attach; daarna close `1009`. Server → client stuurt screen seeds, scroll-snapshots en live tmux-output als strings: rechtstreeks aan een terminalemulator (xterm.js) voeren. Ontbrekende sessie/broker kan met `1001`/`1011` sluiten.

**Resize:** bewust geen resize-frame. Client-resize wordt genegeerd zodat een viewer geen gedeeld pane kan verkleinen; schaal alleen CSS/fontmaat.

**Origin:** alleen bij upgrade. Afwezig is toegestaan; aanwezig moet dezelfde hostname als `Host`, `localhost` of `127.0.0.1` zijn. Ongeldig/malformed: HTTP `403 origin_rejected` vóór upgrade.

**Token:** met `OPENRIG_TERMINAL_BEARER_TOKEN` kan de client `Authorization: Bearer <token>` sturen, of (browser-WebSocket zonder custom headers) `?token=<urlencoded-token>`. Bij expliciete niet-loopback bind valt het terug op `OPENRIG_AUTH_BEARER_TOKEN` als de terminaltoken ontbreekt. Loopback zonder terminaltoken is open. De ingebouwde UI injecteert een geconfigureerde token éénmalig in `localStorage["openrig.terminalBearerToken"]` en gebruikt die voor `?token=`. Een eigen dashboard moet hem niet via een API proberen te lezen: laat een operator hem veilig leveren of gebruik een proxy die WebSocket-authheaders kan zetten. Querytokens kunnen in logs/history terechtkomen.

## Integratieadvies

Poll `/api/ps` en/of per-rig `/nodes` conservatief; gebruik `/api/events` en `/api/activity/events` voor invalidatie. Open transcript, node-detail en terminal pas na expliciete gebruikersactie. Behandel status-, activity-, context- en transcriptvelden als nullable/degradeerbaar: ontbrekend betekent nooit vanzelf “idle”, “stil” of “gezond”.
