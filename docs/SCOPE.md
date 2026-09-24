# OpenRig Dashboard — scope v1

Status: vastgesteld 2026-09-24 met Gino (operator). Eigenaar: orch.lead.

## Doel
Een grafische, klikbare vervanging voor OpenRig's eigen web-UI en `rig tui`, gebouwd
bovenop de OpenRig-daemon (`http://127.0.0.1:7433`). Aanvoelen als de Claude desktop-app.
De kern: **elke needs-you-kaart opent echt een live terminal/chat met de juiste seat.**

## Besluiten (operator)
| Vraag | Besluit |
|---|---|
| Acties v1 | Needs-you → live terminal · chat/bericht sturen · status per agent · queue/taken beheren |
| Navigatie | Sidebar zoals de Claude-app: Needs-you bovenaan, daaronder rigs → seats; rechts seat-detail met tabs Chat / Terminal |
| Rig-beheer | Ja, volledig (up/down/launch/bind, model, permissies) |
| Runtime | Eerst lokale web-app, later desktop-schil (Electron/Tauri) — architectuur daarop voorbereiden |

## Architectuur (voorstel orch.lead)
- `server/`: kleine Node/TypeScript-server in WSL (bijv. `localhost:7500`). Serveert de UI,
  proxyt REST + terminal-websocket naar de daemon, houdt bearer-tokens server-side.
  Rig-beheer-acties die de daemon niet via HTTP biedt gaan via een vaste allowlist van
  `rig`-CLI-commando's (geen vrije shell).
- `web/`: Vite + React + TypeScript, xterm.js voor de terminal.
- UI praat alleen met `server/`, nooit direct met de daemon → later zonder wijziging in een
  desktop-schil te hangen.

## Waves
1. **Fundament + kernpad**: server-proxy, sidebar (rigs/seats met live status), needs-you-lijst,
   seat-detail met werkende Terminal-tab (websocket) en Chat-tab (send + recente output).
   Acceptatie: elke needs-you-kaart → klik → interactieve terminal van precies die seat.
2. **Queue/taken**: lijst per seat/rig, aanmaken, toewijzen/handoff, afsluiten.
3. **Rig-beheer**: rigs starten/stoppen, seats launchen/binden, model- en permissiekeuze.
   Destructieve acties achter een bevestigingsdialoog met rig-naam.

Review: dev.reviewer reviewt onafhankelijk aan het eind van elke wave, vóór "klaar".

## Veiligheidsgrenzen
- Mutaties op draaiende rigs van de operator (`first-project`, `dashboard-team`, kernel) worden
  tijdens ontwikkeling **niet** getest. Wave 3 wordt getest op een aparte, wegwerpbare test-rig
  of tegen mocks.
- Geen push/publish zonder toestemming van de operator.

## Bekende OpenRig 0.5.14-eigenaardigheden om rekening mee te houden
- CLI-commando's als `expand`/`spec show`/`launch` vereisen de rigId (ULID), niet de naam.
- Modelkeuze is niet persistent na herstart van een Codex-seat.
- herdr-terminalintegratie werkt niet; de daemon-websocket `/api/terminal/:sessionName` is de route.

## Verkenning (lopend)
- `docs/discovery/api-inventory.md` — dev.codexdev
- `docs/discovery/needs-you-mapping.md` — dev.deepseek
