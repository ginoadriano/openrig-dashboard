# Onafhankelijke eindreview (live) — 2026-09-24

Reviewer: dev.claudereview (Claude), niet betrokken bij de bouw. Geen applicatiecode gewijzigd, niets gecommit.
Scope: live verificatie tegen daemon `:7433`, dashboard-server `:7500`, Vite `:5173`, plus broncontrole van
`server/src/*` en `web/src/*` tegen `docs/CONTRACT.md`. Inclusief de needs-you-wijziging van dev.deepseek
(`needs-you-resolve.ts` 17:16, `blockedOn` eruit, `item.sourceSession` als 2e kandidaat).

**Werkwijze.** Omdat `:7500` verouderde code draait (zie B1), heb ik de *actuele* bron daarnaast zelf gestart op
`127.0.0.1:7599` (`DASH_MUTATION_ALLOWLIST=dashtest` als vangnet) en alle probes tegen beide servers gedraaid. Na afloop
gestopt. De md5 van `server/src/*.ts` was aan het eind gelijk aan die bij de start, dus de probes hebben één stabiele
bronversie getest. Alle verzoeken waren reads, of verzoeken die vóór de daemon geweigerd moeten worden. WS-frames gingen alleen naar
`t-alpha@dashtest` en naar een niet-bestaande sessie. Op dashboard-team, first-project en kernel is niets gemuteerd en in hun terminals is niets getypt.
De enige leesverbinding met een operator-rig was de read-only WS-stream uit `test/smoke.sh` (`dev-owner@first-project`, verstuurt geen frames).

Legenda: **[live]** = met een live verzoek geverifieerd. **[bron]** = afgeleid uit de broncode. **[live+bron]** = het gedrag is live
gezien en de oorzaak in de bron aangewezen.

## Samenvatting

| # | Ernst | Onderwerp | Verificatie |
|---|---|---|---|
| B1 | blocker (sign-off) | `:7500` en `:5173` draaien niet de gereviewde code (file-watching werkt niet op `/mnt/c`) | live |
| M1 | major | DNS-rebinding: `Host` wordt niet gecontroleerd, dus fleet/queue/**terminal-output** zijn leesbaar voor een externe site | live |
| M2 | major | WS-proxy sluit de client nooit als upstream sluit of een frame wordt geweigerd; de terminal blijft dan op "live" staan en slikt input | live+bron |
| M3 | major | Queue-transities: velden sluiten niet aan op de daemon, daardoor "Invalid Date" en `created → ` zonder state | live+bron |
| M4 | major (productbesluit) | `kernel` wordt volledig weggefilterd, waardoor een kernel-seat met `needs_input` onzichtbaar blijft | live+bron |
| m1 | minor | Web toont `Request failed (4xx)` in plaats van de `ActionResult.message` van de server | live+bron |
| m2 | minor | Dubbele rignamen (3× `dashtest`): opzoeken op sessie pakt de eerste, gestopte rig | live+bron |
| m3 | minor | `/dash/queue`: ongeldige `rig` wordt stil genegeerd (ongefilterde lijst terug), `limit=abc` geeft 500 | live |
| m4 | minor | Rigfilter mist seats met een sessienaam zonder `@rig` (`dev-deepseek`, `dev-claude`, …) | live |
| m5 | minor | Needs-you: kandidaat `item.sourceSession` is dode code en de test "blockedOn must not win" test niets | live+bron |
| m6 | minor | `test/smoke.sh` kan onterecht slagen, WS-resultaten alleen op stderr | bron |
| m7 | minor (ops) | Draaiende `:7500` heeft geen `DASH_MUTATION_ALLOWLIST`, dus één klik kan een operator-rig stoppen | live |
| m8 | minor | `/dash/rigs/up` leest het specbestand relatief aan de server-cwd, niet aan de daemon | bron |

## 1. Kernpad: klopt de gekozen sessie per needs-you-item?

Live snapshot (17:21): `/api/review/fleet` bevat 1 item, `/dash/needs-you` geeft 1 resolved en 0 unresolved.

| Item | Daemon (`/api/review/fleet`) | Dashboard (`/dash/needs-you`) | `rig ps --nodes -A` / tmux | Oordeel |
|---|---|---|---|---|
| `derived:dev-owner_first-project_too-long-in-state_…` | `source=derived`, `identity=dev-owner@first-project\|too-long-in-state\|…`, `qitemId=null`, `destinationSession=null` | `session=dev-owner@first-project`, `rigName=first-project`, `logicalId=dev.owner`, `kind=stuck` | `first-project dev-owner@first-project att`, `sessionStatus=running`, `tmux has-session` ok | **correct** [live] |

- Er stond op dat moment geen `agent`-item (queue_human) open: de queue heeft 24 items, alle `done`, `canceled` of `handed-off`.
  Het agent-pad (human-destination, dan source) heb ik daarom **niet live** geverifieerd, alleen via de unit-tests (7/7) en de bron.
  Zelf een item naar `human@kernel` aanmaken zou in de echte inbox van de operator landen, dus dat heb ik niet gedaan.
  Voorstel als de operator akkoord is: een qitem van `t-alpha@dashtest` naar `human@kernel`. De verwachting is dan `session=t-alpha@dashtest`.
- Daemonbron `domain/review/compose.js:520-537`: agent-items bevatten nooit een `sourceSession`, en hun `identity` is de
  qitemId. In de praktijk levert dus alleen de queue-lookup (`fetchQueueSources`, `index.ts:263-281`) de tweede kandidaat. Dat is
  correct. Zie m5 voor de gevolgen voor de tests.
- De live-map (`index.ts:206-233`) klopt met de werkelijkheid: alle 17 nodes die de server "live" noemt draaien
  (`sessionStatus=running`, tmux-sessie bestaat). De 5 nodes in de gestopte dashtest-rigs (`exited`) zijn terecht niet live.
- Contractshape: alle `items[].session` zijn gevuld (smoke) en `unresolved` heeft geen `session` [live].

## 2. Tests

- `npm --prefix server test`: **7/7 pass** [live]. `npm --prefix server run typecheck`: schoon, maar de tests vallen buiten `include` (zie m5).
- `test/smoke.sh` tegen `:7500`: 7/7 PASS plus 2 WS-PASS. Tegen `:7599` (actuele bron): idem [live]. Zie m6 voor wat de smoke níet vangt.

## 3. Veiligheidsgrenzen (alle probes tegen :7500 én :7599, identiek tenzij vermeld)

Gehouden [live]:
- **Bind-host**: `:7500`, `:5173` en `:7433` luisteren alleen op `127.0.0.1` (`ss -ltnp`).
- **Origin bij mutaties**: 403 voor `null`, `http://127.0.0.1:5173.evil.com`, `http://localhost:5173/`, `HTTP://127.0.0.1:5173`,
  `http://[::1]:5173`, `:5174`, een komma-lijst, en ook bij een ontbrekende Origin. GET `/dash/fleet`, SSE `/dash/events` en PUT posture met een vreemde Origin geven 403.
- **WS-upgrade**: zonder Origin 403, met `evil.example` 403.
- **Id-validatie**: `?x=1`, `../../api/ps`, `..%2Fsse`, een niet-ULID, een ULID met traversal en `lines=999999999` geven allemaal 400. `a/b` in de WS geeft 1008 `invalid_session`.
  `%2E%2E` via een ruwe upgrade geeft 404 (Hono-routing).
- **WS-frames**: `resize`, ongeldige JSON, `keys:[1]` en `scroll:-1` worden niet doorgestuurd.
  **Early-frame-limiet**: 40 frames direct bij open geven op `:7599` een close `1009 early_frame_limit`. Op `:7500` gebeurt dat níet (bewijs voor B1).
- **Confirm/guards**: `down` of `stop` met een verkeerde confirm geeft 400 zonder echo. Posture-PUT zonder bearer geeft 403. Met de allowlist geeft restore op een andere rig 403.

Gebroken: M1 (Host/DNS-rebinding) en M2 (close-propagatie).

## 4. Contract web ↔ server

Zie M3 (transities), m1 (foutboodschap) en m3/m4 (queuefilter). De overige shapes komen overeen (`types.ts` is een 1-op-1-kopie van
`contract.ts`). Live gecontroleerd: `/fleet`, `/needs-you`, `/queue`, `/queue/:id`, de SSE-scopes `fleet`, `needs-you` en `queue`, en de ActionResult-foutshape.

---

## Bevindingen

### B1 — blocker (sign-off) — de live servers draaien oude code [live]
**Waar:** procesconfiguratie: `server/package.json` (`tsx watch src/index.ts`), `web/vite.config.ts` (geen `watch.usePolling`), repo op `/mnt/c` (drvfs).
**Faalscenario:** het server-child PID 1184420 draait sinds 16:53 en is nooit herstart, terwijl `index.ts` en `needs-you-resolve.ts`
om 17:00, 17:07 en 17:16 zijn gewijzigd. Bewijs: 40 early frames geven op `:7500` géén 1009 en de data blijft streamen, terwijl de actuele bron
(`:7599`) `1009 early_frame_limit` geeft. Vite (sinds 15:44) serveert een `api.ts` van 150 regels (op schijf 284) zonder
wave-3-exports. De geserveerde `App.tsx` importeert `RigManagement` niet en rendert `ChatPane` zónder `key` (op schijf wel
`key={seat.session}`). De browser op `:5173` toont dus een UI uit het wave-2-tijdperk. Elke eerdere "live geverifieerd"-claim
(o.a. in `server-review.md`) en elke klik van de operator ging mogelijk tegen andere code dan de gereviewde.
**Fix:** herstart nu beide processen (dat is aan orch.lead, die ze gestart heeft). Structureel: zet de repo op het WSL-ext4-filesystem
(`~/…`), waar inotify werkt. Of zet polling aan: `server.watch.usePolling: true` in Vite, en voor tsx polling (bijv.
`CHOKIDAR_USEPOLLING=1`, eerst verifiëren) of een herstart na elke wijziging. Leg vast dat "live geverifieerd" pas telt na een herstart.

### M1 — major — DNS-rebinding: `Host` wordt niet gevalideerd [live]
**Waar:** `server/src/index.ts:378-388` (GET/HEAD zonder Origin wordt altijd doorgelaten).
**Faalscenario:** een externe pagina `evil.example` wijst na DNS-rebinding naar `127.0.0.1`. De browser van de operator doet dan een same-origin
GET naar `http://evil.example:7500/dash/...`, zonder Origin-header. Live: `curl -H 'Host: evil.example:7500'` op `/dash/fleet`,
`/dash/queue` en `/dash/seats/t-alpha%40dashtest/output` geeft **200 met data**. Via `output?lines=2000` is zo de schermbuffer van
elke seat leesbaar, ook op operator-rigs. Daar kunnen secrets in staan. Mutaties blijven dicht, want de POST krijgt dan
`Origin: http://evil.example:7500` en wordt geweigerd. Vite zelf blokkeert een vreemde Host wel ("Blocked request", 403), de
dashboard-server op `:7500` niet.
**Fix:** zet een Host-allowlist in dezelfde middleware (`127.0.0.1:${PORT}`, `localhost:${PORT}`) en geef 403 voor alle andere Hosts. De Vite-proxy zet met
`changeOrigin: true` al `Host: 127.0.0.1:7500`, dus de UI blijft werken.

- **opgelost in: `app.use("*")`-middleware + `hostAllowed` (server/src/index.ts).** Elke request (GET, SSE, WS-upgrade én mutaties) moet een `Host` in `{127.0.0.1:PORT, localhost:PORT, [::1]:PORT}` hebben, anders 403. Geverifieerd live: `Host: 127.0.0.1:7501` → 200, `Host: evil.example:7501` → 403 op `/dash/fleet`.

### M2 — major — de WS-proxy geeft een upstream-close of weigering niet door aan de client [live+bron]
**Waar:** `server/src/index.ts:549,552` (upstream close/error roept alleen `cleanup()` aan) en `561,566` (bij een geweigerd frame wordt alleen
`daemonWs.close(1007)` aangeroepen, de client niet). Daarnaast `web/src/TerminalPane.tsx:61-72`: reconnect gebeurt alleen bij `onclose`.
**Faalscenario:** de daemon sluit zelf correct met `1008 session not found: zz-nope@dashtest` (live, direct op `:7433`). Via
het dashboard blijft de client-socket echter **OPEN met 0 bytes** (live, `:7500` en `:7599`). Hetzelfde gebeurt na een `resize`, ongeldige JSON,
`keys:[1]` of `scroll:-1`. De client blijft open en ontvangt niets meer. In de UI staat dan "live", terwijl `onMessage` alle
toetsaanslagen stil weggooit (`if (closed) return`) en er nooit een reconnect komt. Realistische triggers zijn een seat die herstart
of stopt, een daemon-herstart, of een needs-you-kaart voor een sessie die net verdwenen is. Dat raakt de kernacceptatie ("klik → interactieve terminal").
**Fix:** laat `cleanup` ook `ctx.close(code, reason)` doen. Stuur de upstream close-code en -reden door (bijv. 1008 of 1011) en sluit bij
geweigerde frames de client met 1007/1008. Registreer `close` al vóór `open`. Geef in TerminalPane de close-reden weer, zodat
"session not found" zichtbaar wordt.

- **opgelost in: `upgradeWebSocket("/dash/terminal/:session")` (server/src/index.ts).** `cleanup(code, reason)` sluit nu óók de client (`closeClient`); upstream `close`/`error` geven de code+reden door (resp. `1008`/`1011`), alleen voor `open` geregistreerd. Geweigerde/invalide frames sluiten de client met `1007`/`1008` (i.p.v. alleen de daemon). Geverifieerd live met een `ws`-client: niet-bestaande sessie → client sluit `1008 session not found: …`; `resize`-frame → client sluit `1008 frame_not_allowed`.

### M3 — major — queue-transities matchen niet met de daemon [live+bron]
**Waar:** `server/src/index.ts:359-367` (`mapTransition`), `server/src/contract.ts:146-156` (`DaemonQueueTransition`),
`web/src/QueueView.tsx:285-288`.
**Faalscenario:** de daemon levert `{ ts, state, actorSession, transitionNote, … }` (live: `/api/queue/qitem-20260924140210-49fa9923/transitions`).
De server leest `at ?? tsCreated` en `fromState`/`toState`, en die bestaan niet. Live antwoord van `/dash/queue/:id`:
`{"at":"","actor":"operator-human@kernel","note":"created"}`. `fromState` en `toState` ontbreken. De UI rendert per transitie
`Invalid Date` en `created → ` zonder doelstate. De taakgeschiedenis van wave 2 is daardoor onbruikbaar.
**Fix:** `at: t.ts`, `toState: t.state`, `fromState` = de `state` van de vorige transitie (of `null` voor de eerste). Pas het daemontype aan
en voeg een fixture-test met een echte daemonrespons toe.

- **opgelost in: `server/src/queue-transitions.ts` (`mapTransitions`) + `contract.ts` (`DaemonQueueTransition`).** Rio `at: t.ts`, `toState: t.state`, `fromState` = vorige transitiestate (null voor eerst), `actor: actorSession`, `note: transitionNote`. Fixture-test `server/test/queue-transitions.test.ts` met de echte daemonrespons (`ts/state/actorSession/transitionNote`). Live: `/dash/queue/qitem-…/transitions` → `2026-09-24T14:02:10.596Z null → pending created` en `… pending → handed-off handoff final`.

### M4 — major (productbesluit nodig) — `kernel` wordt volledig verborgen [live+bron]
**Waar:** `server/src/index.ts:222` (`if (dr.name === "kernel") continue;`). Ook de live-map slaat kernel daardoor over. Nergens in SCOPE of discovery gedocumenteerd.
**Faalscenario:** live staat `queue-worker@kernel` op `activity=needs_input` (`rig ps`: `selection_prompt`). Die seat wacht op de operator. Het
dashboard toont hem niet in de sidebar, en `/api/review/fleet` zet hem niet in needs-you, dus hij is nergens te zien. Verder zou een
needs-you-item waarvan de enige live kandidaat een kernel-seat is (bijv. een vraag van `advisor-lead@kernel` aan `human@kernel`)
altijd in `unresolved` belanden, zonder terminal [bron].
**Fix:** laat de operator beslissen. Voorstel: toon kernel in de sidebar (read-only mag) en neem kernel-seats op in de live-map.
Overweeg daarnaast om seats met `activity=needs_input` als eigen needs-you-kaart (`kind: "permission_prompt"`, al genoemd in CONTRACT) te tonen.

- **opgelost in: `fetchFleetData` (kernel-filter verwijderd) + `fetchNeedsYou`/`collectNeedsInputSessions` (server/src/index.ts).** Operator-besluit: kernel volledig tonen als gewone rig, inclusief beheer. Kernel-seats zitten nu in `fleet` én de live-map. Seats met `activity=needs_input` krijgen een needs-you-kaart `kind:"permission_prompt"` (dedup op session wanneer `/api/review/fleet` ze al dekt). Live: fleet toont `kernel` met 4 seats; `queue-worker@kernel` (needs_input) verschijnt als `permission_prompt`-kaart.

### m1 — minor — de server-foutboodschap valt weg in de web-UI [live+bron]
**Waar:** `web/src/api.ts:28-32`. `dashboardFetch` leest alleen `body.error`. Wave-3-fouten zijn `{ ok:false, message }` met 4xx.
**Faalscenario:** live geeft een verkeerde confirm `400 {"ok":false,"message":"confirm does not match…"}`, en een allowlist-weigering
`403 {"ok":false,"message":"mutations are only allowed…"}`. De UI toont `Request failed (400)` / `(403)` en niet de "duidelijke melding" die de README belooft.
**Fix:** gebruik in `dashboardFetch` als fallback `body.message` wanneer `error` ontbreekt.

### m2 — minor — dubbele rignamen geven een verkeerde rig-context [live+bron]
**Waar:** `server/src/index.ts:827-835` (`fetchSessionSeatInfo`: eerste match op sessie), `web/src/App.tsx:87-89` (`openNeed`: eerste match).
**Faalscenario:** live zijn er 3 rigs met de naam `dashtest` (twee gestopt, één running) met dezelfde sessienamen. Voor `t-alpha@dashtest`
kiezen server en UI de eerste, gestopte rig `01M39W1B…`. De model-GET leest dan de node van de verkeerde rig. Een needs-you-kaart opent onder de gestopte
rig (de terminal zelf klopt, want dezelfde tmux). In de sidebar lichten alle drie de `t-alpha` tegelijk op als "selected".
**Fix:** gebruik liever de live/running node, of match op `rigName`/`rigId` uit het needs-you-item. Ruim de wegwerp-dashtest-rigs op.

- **opgelost in: `fetchSessionSeatInfo` (server/src/index.ts).** Gebruikt nu `fetchFleetData` en kiest bij dubbele sessienamen de node waarvan de sessie in de live-map zit (running); pas daarna de eerste match. (UI-kant we laten de `web`-fix aan dev.codexdev.)

### m3 — minor — queue-queryparams worden slordig gevalideerd [live]
**Waar:** `server/src/index.ts:668-672`.
**Faalscenario:** `?rig=..%2Fx` wordt stil genegeerd en geeft de **ongefilterde** lijst terug in plaats van 400. `?limit=abc` gaat door naar de daemon en geeft `500 daemon_error`.
`state` wordt ongevalideerd doorgegeven. Een onbekende state geeft `[]`, en dat is acceptabel.
**Fix:** geef 400 bij een ongeldige `rig`, `limit` of `activeOnly`, en valideer `state` tegen de bekende states.

- **opgelost in: `GET /dash/queue` (server/src/index.ts).** `rig` en `session` tegen de allowlists; `state` tegen de bekende stateset; `activeOnly` ∈ {0,1}; `limit` ∈ [1,1000]. Geverifieerd: `limit=abc` → 400, `state=bogus` → 400, `rig=..%2Fx` → 400.

### m4 — minor — het rigfilter mist seats zonder `@rig`-suffix [live]
**Waar:** gedrag van de daemon (`queue-repository.js:2267-2270`: `LIKE '%@<rig>'`), overgenomen via `QueueView.tsx:34-36`.
**Faalscenario:** `?rig=dashboard-team` toont alleen `…@dashboard-team`-sessies. Taken van `dev-deepseek`, `dev-claudereview`, `dev-claude` en
`dev-opencode` (canonieke sessies zonder suffix) verdwijnen onder het rigfilter. Daarnaast zijn er queue-items geadresseerd aan
`dev-deepseek@dashboard-team`, terwijl de echte sessie `dev-deepseek` heet. Die verschijnen niet in de Tasks-tab van die seat.
**Fix:** filter in de server op rig via de fleet-roster (sessies van de rig) in plaats van op de suffix. De naamsmismatch hoort bij de operator/daemon, niet bij het dashboard.

- **opgelost in: `GET /dash/queue` (server/src/index.ts).** `?rig=` wordt nu uitgevoerd als client-side filter over de fleet-roster (session én logicalId van de rig-seats, plus `@rig`-suffix match), niet meer via de daemon-suffix-LIKE. Geverifieerd: `rig=dashboard-team` vindt items naar `dev-deepseek@dashboard-team` (seat `dev-deepseek` zonder suffix).

### m5 — minor — needs-you: dode kandidaat en een test die niets test [live+bron]
**Waar:** `server/src/needs-you-resolve.ts:33`, `server/test/needs-you-resolve.test.ts` (test "live blockedOn … must NOT win"), `server/tsconfig.json:17`.
**Faalscenario:** (a) de daemon levert nooit `sourceSession` op agent-items (live keys van `/api/review/fleet` plus `compose.js:520-537`). `item.sourceSession`
is dus altijd `undefined`. Dat is onschadelijk, maar suggereert een pad dat niet bestaat. (b) De test die moet aantonen dat `blockedOn` niet wint, bevat geen
`blockedOn` en geen live blockedOn-sessie, dus hij zou ook slagen als de oude code terugkwam. (c) Twee tests geven nog `blockedOn: null` aan
`QueueSource`. Dat is een excess property, maar het wordt niet gevangen omdat `include: ["src"]` de tests uitsluit van de typecheck.
**Fix:** schrijf de test met een input die de oude volgorde zou laten falen: `fetchQueueSources` ontvangt een blockedOn die live is, en die mag niet
gekozen worden. Kan dat niet meer, omdat het veld niet meer bestaat, verwijder de test dan. Neem `test/` op in een typecheck.

- **opgelost in: `server/tsconfig.typecheck.json` + `server/test/needs-you-resolve.test.ts` + `server/src/needs-you-resolve.ts`.** `test/` is opgenomen in een aparte typecheck-config (`npm run typecheck` = `tsc -p tsconfig.typecheck.json`, include `src` én `test`); de lege `blockedOn`-test is vervangen door twee echte cases: (a) `item.sourceSession` als directe tweede kandidaat zonder `qitemId`, en (b) fallback-orde `item.sourceSession` vóór `queue.sourceSession`. `item.sourceSession` zelf is gedocumenteerd als optionele forward-compat-kandidaat (de daemon levert hem niet; de queue-lookup dekt het werkelijke pad). Typecheck dekt nu ook de tests (geen excess `blockedOn` meer).

### m6 — minor — `test/smoke.sh` kan onterecht slagen [bron]
**Waar:** `test/smoke.sh:40-61`.
**Faalscenario:** de WS-resultaten gaan alleen naar stderr (`tee /dev/stderr | grep -q FAIL`). Crasht `node` of print het niets, dan is er geen FAIL en dus exit 0.
"WS foreign origin refused" slaagt ook als de server helemaal niets streamt. Er is geen check dat de server de actuele bron draait
(B1), en geen close-propagatie-check (M2).
**Fix:** tel expliciet het aantal verwachte PASS-regels, check de 403 op de upgrade in plaats van 0 bytes, en voeg de probes toe
"nonexistent session → client ontvangt close" en "Host: evil → 403".

### m7 — minor (ops) — de dev-server draait zonder mutation-allowlist [live]
**Waar:** omgeving van PID 1184420 (`/proc/…/environ`: geen `DASH_MUTATION_ALLOWLIST`).
**Faalscenario:** volgens SCOPE worden mutaties op operator-rigs tijdens ontwikkeling niet getest. Toch kan één verkeerde klik in de dev-UI (met confirm)
`first-project` of `dashboard-team` stoppen. Zodra B1 is opgelost en de wave-3-UI echt geserveerd wordt, is dat pad actief.
**Fix:** start de dev-server met `DASH_MUTATION_ALLOWLIST=dashtest` totdat de operator productiegebruik vrijgeeft.

### m8 — minor — `/dash/rigs/up` controleert een ander bestand dan de daemon start [bron]
**Waar:** `server/src/index.ts:878-887`.
**Faalscenario:** een relatief `./spec.yaml` wordt gelezen relatief aan de cwd van de server (`server/`), terwijl de daemon `sourceRef` zelf
en met een eigen cwd resolvet. De allowlist-check kan dus de `name:` van een ander bestand beoordelen. Verder leest de regex de eerste `name:` op
willekeurige diepte, en een 403 echoot de `name:`-regel van een willekeurig lokaal bestand.
**Fix:** accepteer alleen absolute paden (of resolve ze tegen een vaste rigs-dir), parse YAML en neem de top-level `name`. Houd bij twijfel de allowlist gesloten.

- **opgelost in: `resolveSourceRigName` + `POST /dash/rigs/up` (server/src/index.ts).** Alleen absolute paden (`/…`) met `.yaml`/`.yml` worden geaccepteerd; de top-level YAML-`name:` (kolom 0) wordt gelezen; bij elke twijfel blijft de allowlist gesloten (403) zonder de bestandsinhoud te echoën. Geverifieerd: relatief pad → 403; absoluut dashtest-spec → daemon 409 `rig_name_running` (dus naam goed herkend); ander rig-spec → 403.

## Positief geverifieerd
- De needs-you-kernresolutie klopt voor het enige live item, en de live-map sluit gestopte seats correct uit.
- Origin-guard, WS-origin, id-validatie, confirm-checks, de posture-token-guard, de loopback-bind en SSE (drie scopes) werken live zoals beschreven in `server-review.md`,
  en de 1009-limiet werkt in de actuele bron.
- Geen tokens naar de client: `/proc` van de server bevat geen `OPENRIG_*_BEARER_TOKEN`, en `grep -i 'bearer|token'` op de responses en headers van `/fleet`, `/needs-you` en `/queue` vindt niets.

## Niet gedaan / open
- Agent-item (queue_human) niet live, om de reden in §1. Dat kan op dashtest met akkoord van de operator.
- Geen browsersessie door de UI geklikt. Door B1 zou dat oude code testen. Doe dit na een herstart opnieuw.

## Opvolging web

- opgelost in `web/src/TerminalPane.tsx` (close-redenen zijn zichtbaar; 1007/1008 worden offline zonder reconnect, 1006/1011 reconnecten)
- opgelost in `web/src/QueueView.tsx` en `web/src/types.ts` (lege/ongeldige transitie-tijd en ontbrekende states renderen zonder `Invalid Date`)
- opgelost in `web/src/api.ts` (`dashboardFetch` gebruikt `body.message` als fallback)
- opgelost in `web/src/App.tsx` (needs-you kiest sessionkandidaten eerst op rigName en daarna de running rig; sidebarselectie matcht rigId én session)

## Agent-pad live

Opdracht (orch.lead, met akkoord van de operator): één queue-item van `t-alpha@dashtest` aan `human@kernel` aanmaken, dan de kaart,
de UI en de cancel controleren. **Status: uitgevoerd en geslaagd, na expliciete toestemming van de operator voor de create (zie "Uitkomst" onderaan deze sectie).**
Eerste poging (historisch):

- Poging 1 (`POST /api/queue/create`, `X-OpenRig-Session: t-alpha@dashtest`, alleen `body`) werd door de daemon geweigerd met
  `400 human_route_fields_required`: human-routed items vereisen `summary` en `evidenceRef` (`domain/human-route-enforcer.js:40-42`).
  Er is niets aangemaakt. Gecontroleerd: `/api/queue/list?sourceSession=t-alpha@dashtest` geeft 0 items.
- Poging 2 (met `summary` en `evidenceRef`) is geblokkeerd door de permissieclassifier van mijn harness (schrijven naar een extern systeem).
  Die heb ik niet omzeild. Voor een vervolg moet de operator deze ene create expliciet toestaan, of het item zelf aanmaken, bijv.
  `rig queue create --source t-alpha@dashtest --to human@kernel --summary "DASHBOARD TEST" --evidence-ref docs/reviews/claude-final-review.md` (syntax eerst checken met `rig queue create --help`).
  Daarna kan ik stappen 1-3 (needs-you, UI, cancel) doen.
- Herstart geverifieerd [live]: `:7500` en Vite draaien sinds 17:32, `:7500` met `DASH_MUTATION_ALLOWLIST=dashtest`. Vite serveert nu de
  actuele `api.ts` (`savePosture` aanwezig) en `App.tsx` (importeert `RigManagement`). B1 is daarmee opgelost.

### Nieuwe bevindingen tijdens deze stap

**M5 — major — een derived needs-you-kaart voor een live seat valt in `unresolved` als de identity een andere sessienaam gebruikt [live]**
**Waar:** `server/src/needs-you-resolve.ts` (identity-prefix wordt alleen exact gematcht op de live-map).
**Faalscenario:** live `/api/review/fleet` heeft nu `identity=dev-deepseek@dashboard-team|too-long-in-state|…`, terwijl de canonieke,
draaiende sessie van `dev.deepseek` `dev-deepseek` heet (zonder suffix). `/dash/needs-you` zet de kaart in `unresolved` (geen terminal),
terwijl de seat live is. Hetzelfde geldt voor elke seat waarvan de canonieke naam afwijkt van `<member>@<rig>` (live ook `dev-claude`,
`dev-opencode`, `dev-claudereview`). De naamsmismatch ontstaat in de daemon/seat-setup, maar het dashboard kan hem oplossen.
**Fix:** is de exacte match mislukt, split de prefix dan in `<naam>@<rig>` en zoek in de live-map een seat van rig `<rig>` met canonieke sessie `<naam>`
(of met logicalId `<pod>.<member>` als de naam `<pod>-<member>` is). Voeg een unit-test toe met precies deze live identity.

- **opgelost in: `server/src/needs-you-resolve.ts` (`resolveNeedsYouSession` laatste stap) + `server/test/needs-you-resolve.test.ts`.** Na exacte matching faalt, splitst de resolver de identity-prefix `volgens <pod>-<member>@<rig>` en zoekt de live node met `logicalId <pod>.<member>` in rig `<rig>` → gebruikt diens canonieke live sessie; alleen bij precies één match. Tests: `dev-deepseek@dashboard-team` → `dev-deepseek` (live identity uit de review) + ambigu geval (twee nodes met dezelfde logicalId in één rig) → `null`. Live: `/dash/needs-you` toont nu de `dev-deepseek`-stuckkaart opgelost naar `dev-deepseek`.

**m9 — minor — het dashboard kan geen taak aan een mens aanmaken [bron+live daemonfout]**
**Waar:** `server/src/index.ts` `POST /dash/queue` (stuurt alleen `destinationSession`, `body`, `priority` en `tags` door).
**Faalscenario:** een taak met als bestemming `human@kernel` (of een andere human-seat) geeft altijd daemon-`400 human_route_fields_required`, omdat `summary` en `evidenceRef` niet
worden doorgegeven en de UI er geen velden voor heeft.
**Fix:** neem `summary?` en `evidenceRef?` op in het contract, geef ze door, en toon ze in het New-task-formulier zodra de bestemming een human-ref is.

- **opgelost in: `POST /dash/queue` (server/src/index.ts) + `docs/CONTRACT.md`.** Accepteert nu optioneel `summary` en `evidenceRef` (validatie: string) en stuurt ze door naar `/api/queue/create` wanneer aanwezig; `docs/CONTRACT.md` wave-2-rij is bijgewerkt. (Web UI-velden zijn voor dev.codexdev.)

### Uitkomst agent-pad [live]

Aangemaakt: `qitem-20260924161506-d8cf6875` (`t-alpha@dashtest` → `human@kernel`, summary en evidenceRef gezet, gemarkeerd als test).

1. **needs-you: correct.** Daemon-item `source=agent`, `destinationSession=human@kernel`. `/dash/needs-you` resolved het als
   `kind=queue_human`, `session=t-alpha@dashtest`, `rigName=dashtest`, `logicalId=t.alpha`. De human-destination wordt overgeslagen en
   de source via de queue-lookup gekozen. Omdat de server alleen running nodes in de live-map zet, is het de running dashtest-rig `01M39YJP…`.
2. **UI: correct.** Headless Edge via CDP (eigen wegwerpprofiel, daarna gestopt) opende `http://127.0.0.1:5173`. Er stonden 2 kaarten, waaronder
   `QUEUE HUMAN | DASHBOARD TEST … | dashtest · t.alpha | Open terminal →`. Na een klik is de tab **Terminal** actief, alleen de
   `t.alpha` onder de **RUNNING** dashtest-groep is geselecteerd (de twee gestopte niet), de kop toont `DASHTEST / t.alpha / RUNNING`, de terminalbalk
   `LIVE TERMINAL · t-alpha@dashtest` en de xterm de prompt van die pane.
3. **Cancel: correct.** Via het dashboard zelf (`POST /dash/queue/:id/update {state:"canceled"}`, Origin 5173) → daemonstate `canceled`,
   transities `null → pending (t-alpha@dashtest)` en `pending → canceled (operator-human@kernel)`. Bij de volgende compose (≤20 s)
   verdween de kaart uit `/api/review/fleet` en `/dash/needs-you`. De daemon maakte zelf een stuck-sweep-item
   `qitem-recovery-f41a88a05886c6b8` ("undelivered-wake": `human@kernel` heeft geen terminaltransport). Dat heeft hij om 17:27:38Z zelf
   op `done` gezet ("no longer detected"), dus daar hoefde niets meer gecanceld te worden.

## Slotcontrole

Gedaan om 19:28–19:40 lokale tijd. `:7500` (PID 1748933) is gestart om 18:25:53, ná de laatste serverwijziging (18:18), met `DASH_MUTATION_ALLOWLIST=dashtest`.
Vite pollt (`watch.usePolling`) en serveert aantoonbaar de actuele modules (`Time unknown` in QueueView, `setCloseReason` in TerminalPane).

**Suites [live]:** `npm test` 10/10, `npm run typecheck` (inclusief `test/`) schoon, `test/smoke.sh` 12/12, web `lint` en `build` ok.

| Bevinding | Bron | Live | Oordeel |
|---|---|---|---|
| B1 stale servers | – | processtart na mtimes; Vite-polling werkt | **opgelost** |
| M1 Host/DNS-rebinding | `hostAllowed` | `Host: evil` → 403 op fleet en output; localhost en Vite 200 | **opgelost** |
| M2 WS-close | cleanup sluit client + TerminalPane close-reden | nonexistent → `1008 session not found`; resize/keys/scroll → `1008 frame_not_allowed`; ongeldige JSON → `1007` | **opgelost** |
| M3 transities | `queue-transitions.ts` + test | `at`/`fromState`/`toState` correct, ook op het testitem | **opgelost** |
| M4 kernel | filter weg, `permission_prompt` | kernel in fleet (4 seats); `queue-worker@kernel` → `permission_prompt`-kaart | **opgelost** (operatorbesluit: tonen incl. beheer) |
| M5 identity ≠ sessie | logicalId-fallback + tests | `dev-deepseek`-stuckkaart → `session=dev-deepseek` | **opgelost** |
| m1 foutboodschap | `dashboardFetch` valt terug op `message` | server geeft `{ok:false,message}` | **opgelost** |
| m2 dubbele rignamen | server: live match eerst; web: rigName+running, selectie op rigId | UI koos de running rig, enkele highlight | **opgelost** |
| m3 queue-params | validatie | `limit=abc`/`0`, `state=bogus`, `rig=../x`, `activeOnly=2` → 400 | **opgelost** |
| m4 rigfilter | rosterfilter | live niet discriminerend (geen item naar een sessie zonder suffix) | **opgelost in bron**, zie open punt 1 |
| m5 tests/typecheck | `tsconfig.typecheck.json` incl. test | typecheck schoon | **opgelost** |
| m6 smoke | 12 checks + telling | 12/12 | **opgelost** |
| m7 allowlist | – | `/proc` env: `DASH_MUTATION_ALLOWLIST=dashtest` | **opgelost** (ops) |
| m8 rigs/up | abs. pad + top-level name | relatief → 403, `/etc/passwd` → 403, ander rig-spec → 403 | **opgelost** |
| m9 human-taak | server geeft summary/evidenceRef door | – | **half**: de server is klaar, de web-UI heeft de velden nog niet (zie open punt 2) |

**Eindoordeel v1: JA, klaar.** Het kernpad (needs-you → juiste seat → live terminal) is voor alle drie itemtypes live bewezen: derived stuck,
agent/queue_human en permission_prompt. Alle blocker- en major-bevindingen zijn live geverifieerd opgelost en de veiligheidsgrenzen houden stand.
Wat openstaat is minor en blokkeert v1 niet:

1. **m4-restpunt (minor, bron):** in `GET /dash/queue` (`server/src/index.ts:739-778`) wordt het rigfilter pas ná de daemon-`limit` toegepast. De UI vraagt
   `limit=100` over alle rigs, en items van een rig die buiten de 100 nieuwste vallen verdwijnen dan stil uit de rigweergave. Fix: bij een rigfilter
   het limit server-side pas na het filteren toepassen, of de daemon per rostersessie bevragen.
2. **m9-webkant (minor):** `QueueView` en `api.ts` hebben geen `summary`/`evidenceRef`. Een nieuwe taak aan `human@kernel` via de UI geeft dus nog steeds
   `human_route_fields_required`.
3. **M5-heuristiek (minor, bron):** de split op de *laatste* `-` gaat mis bij members met een streepje (`dev-code-x@rig` → `dev-code.x`). Hij faalt
   veilig (unresolved, geen verkeerde terminal).
4. **Scope-notitie:** wave-3-mutaties zijn bewust alleen op afwijzing getest (confirm, allowlist, pad, token). Een geslaagde down/restore/launch
   heb ik in deze review niet uitgevoerd. De servergerapporteerde dashtest-successen van de bouwers heb ik niet opnieuw gedaan.

## Hercontrole vervolg

Gedaan om 19:55 lokale tijd. `:7500` is gestart om 19:51:07, ná de laatste wijziging (19:43), met `DASH_MUTATION_ALLOWLIST=dashtest`. `npm test` geeft 12/12 [live].
**Let op:** de serverwijzigingen van deze ronde (`index.ts`, `needs-you-resolve.ts`, `needs-you-resolve.test.ts`) zijn **niet gecommit**. `git status` geeft `M`, HEAD = 2b114c5.
Ik heb zelf geen items aangemaakt.

| # | Punt | Bron | Live | Oordeel |
|---|---|---|---|---|
| 1 | Rigfilter vóór limit | met rigfilter: daemon `limit=1000`, rosterfilter, dan het gevraagde limit (`index.ts` ~760-790) | `limit=1` → `b1461514` (dashboard-team, nieuwste overall); `rig=dashtest&limit=1` → `200773d8` (t-alpha@dashtest) | **opgelost.** Restrand: boven 1000 items in de fleet treedt hetzelfde effect op, nu acceptabel |
| 2 | Streepjes-heuristiek | probeert elke `-` als pod/member-grens en accepteert alleen precies één match (`needs-you-resolve.ts` ~74-96). Tests `dev-code-x@testrig` → sessie en ambigu → `null` | tests groen; bestaande `dev-deepseek`-kaart blijft resolven | **opgelost** |
| 3 | `normalizeSession` + bezorging | `dev-deepseek` → `dev-deepseek@dashboard-team` bij `POST /dash/queue` (`index.ts` ~820-835) | aanmaken lukt, **bezorgen niet** (zie hieronder) | **niet opgelost (major)** |

**3 in detail [live].** `/api/queue/undelivered` bevat nu 6 rijen, allemaal `destinationSession=dev-deepseek@dashboard-team`, `pickup=unclaimed`:
de drie items uit de slotcontrole (`fd70e731`, `cb929df6`, `bc8b4973`) en drie stuck-sweep-recoveryrijen (`qitem-recovery-7feba372…`, `e8326ca3…`, `e3f722ca…`).
De daemon noemt de oorzaak letterlijk: `wake failed (failed:Session 'dev-deepseek@dashboard-team' not found: tmux reports no session with this name. No text was sent.)`.
`tmux has-session -t dev-deepseek@dashboard-team` faalt, `tmux has-session -t dev-deepseek` slaagt. De daemon eist voor adressering `<naam>@<rig>`,
maar wekt op de letterlijke tmux-naam. Voor een seat waarvan de canonieke sessie geen suffix heeft, kan dus geen enkel queue-item worden bezorgd.
De recoveryrijen gaan naar hetzelfde onbereikbare adres, dus niemand krijgt ooit een melding.
Het testitem van dev.deepseek (`qitem-20260924174401-b1461514`) bewijst niets over bezorging: het werd na 1 s gecanceld (`17:44:01.356Z` → `17:44:02.422Z`), ruim vóór de sweep (~3 min).

Gevolg voor het dashboard: `normalizeSession` maakt van een luide daemon-400 (`unknown_destination_rig`) een **stil** succes. De UI meldt dat de taak is
aangemaakt, maar de seat wordt nooit gewekt. Dat is slechter dan de fout die het verving.

**Fix (tweeledig).**
- *Dashboard, nu:* normaliseer niet stil. Is de canonieke sessie van de bestemming ≠ het adres dat de daemon accepteert, weiger dan met een duidelijke fout
  ("seat dev-deepseek is niet bezorgbaar via de queue: canonieke sessie zonder @rig"), of accepteer met een expliciete `warning` in de respons en toon die in de UI.
  Liefst ook een live-check achteraf: staat het nieuwe item in `/api/queue/undelivered`, meld dat dan.
- *Topologie (operator/orch.lead):* de werkelijke oorzaak is dat `dev.deepseek` (en ook `dev.claudereview`, `dev.claude`, `dev.opencode`) een canonieke
  sessie zonder `@rig` heeft. Herlaunch of hernoem die seats naar `<pod>-<member>@<rig>`, of laat de daemon bij het wekken via de canonieke sessie van de node resolven.
  Dat is buiten de scope van het dashboard.

**Opruimen (voor orch.lead, niet door mij gedaan):** de drie items en drie recoveryrijen hierboven staan open in de undelivered-lijst. orch.lead heeft het werk
rechtstreeks aan dev.deepseek gegeven, dus deze rijen kunnen gecanceld worden. Dan sluit de sweep zijn eigen findings.

**Oordeel:** 1 en 2 opgelost en live bevestigd. 3 is niet opgelost: aanmaken werkt, bezorgen niet, en de stille normalisatie verbergt dat. Het oordeel "v1 klaar"
blijft staan, want het kernpad needs-you → terminal is hier niet van afhankelijk. Queue-taken aan seats zonder `@rig` zijn echter aantoonbaar onbezorgbaar en dat
moet de UI eerlijk melden. Daarnaast: commit de serverwijzigingen van deze ronde nog.

- **opgelost in: `POST /dash/queue` + `rejectBareSession` (server/src/index.ts).** Stille normalisatie verwijderd. Als `destinationSession` geen `@` bevat en de fleet-roster de seat in precies één rig vindt, weigert de server met duidelijke 400: "Seat 'dev-deepseek' (logicalId dev.deepseek) cannot receive queue tasks: its tmux session is named 'dev-deepseek', but the daemon addresses it as 'dev-deepseek@dashboard-team' and cannot deliver there. Use Chat to send a message, or rebind the seat ...". `docs/CONTRACT.md` vermeldt deze validatie. Geverifieerd: `POST /dash/queue destinationSession=dev-deepseek` → 400 met de foutboodschap (geen daemon-contact).
