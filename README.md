# OpenRig Dashboard

Een klikbare web-interface voor OpenRig, als vervanging voor de ingebouwde web-UI en `rig tui`.
Needs-you-kaarten openen direct een live terminal van de juiste agent.

## Starten

Vereist: WSL2 met een draaiende OpenRig-daemon op `http://127.0.0.1:7433` (`rig start`).

```bash
npm install && npm --prefix server install && npm --prefix web install   # eenmalig
npm run dev
```

Open daarna **http://127.0.0.1:5173** in je (Windows-)browser.

- `server/` — Node/Hono op `127.0.0.1:7500`; praat met de daemon, houdt tokens server-side.
- `web/` — Vite + React + xterm.js; praat alleen met `server/` via `/dash/*`.
- `VITE_MOCK=1 npm --prefix web run dev` draait de UI met testdata, zonder server.

## Configuratie (env, `server/`)

| Variabele | Doel |
|---|---|
| `PORT` | Poort van de dashboard-server (standaard `7500`). |
| `DASH_ALLOWED_ORIGINS` | Komma-gescheiden lijst van toegestane `Origin`-headers voor mutaties (POST/PUT) en WebSocket-upgrades. Standaard: `http://127.0.0.1:5173,http://localhost:5173` plus eigen origin. GET/HEAD accepteren aanwezige allowed origins; mutaties zonder/onbekende Origin worden afgewezen (403). |
| `OPENRIG_TERMINAL_BEARER_TOKEN` | Alleen nodig als de daemon een terminal-token vereist (op loopback standaard niet). |
| `DASH_OPERATOR_SESSION` | Afzender-identiteit waarmee het dashboard queue- en beheeracties uitvoert (standaard `operator-human@kernel`). |
| `DASH_MUTATION_ALLOWLIST` | Komma-gescheiden lijst van rignamen waarop muterende beheeracties (down/archive/up/restore/seat-launch/seat-stop/seat-model/snapshot/bind) zijn toegestaan. **Niet gezet = geen beperking** (productie-volwaardig rig-beheer); gezet = alleen die rigs, anders `403` met duidelijke melding. |
| `OPENRIG_AUTH_BEARER_TOKEN` | Operator-bearer van de daemon, nodig voor `PUT /dash/rigs/:rigId/posture` (daemon-route `/api/rig-mode/bindings` vereist dit; loopback-daemons zonder geconfigureerde bearer hebben dit nergens voor nodig). Zonder deze env weigert de server posture-mutaties met een duidelijke fout. |

## Documentatie

- `docs/SCOPE.md` — doel, besluiten, waves, veiligheidsgrenzen
- `docs/CONTRACT.md` — API tussen web en server
- `docs/discovery/` — onderzoek naar de daemon-API en de needs-you → sessie-mapping
