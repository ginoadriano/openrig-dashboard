# Onafhankelijke web-review — 2026-09-24

Scope: `web/` tegen `docs/CONTRACT.md` (waves 1–3) en `docs/SCOPE.md`. Geen broncode gewijzigd. De reguliere build, lint en `VITE_MOCK=1`-build slagen alle drie. De hieronder genoemde issues zijn uit broninspectie afgeleid; een live daemon kon niet worden gebruikt omdat netwerk/daemon niet beschikbaar is.

## Bevindingen

1. **major** — `web/src/TerminalPane.tsx:75-81` — De terminal verstuurt alleen `text` en een beperkte set `keys`; er is geen pad dat een `{"type":"scroll","offset":N}`-frame verstuurt. Bij een sessie waarvoor oudere terminalbuffer via de daemon moet worden opgehaald, verandert lokaal scrollen alleen xterm en ontvangt de server nooit de vereiste offset. **Voorgestelde fix:** verbind de relevante xterm-scroll/viewport-gebeurtenis met een JSON `scroll`-frame (uitsluitend bij een open socket); behoud het bestaande verbod op resize-frames.

2. **major** — `web/src/App.tsx:390-405` — `ChatPane` annuleert of versioneert lopende output-requests niet wanneer de gebruiker snel van seat wisselt. Een trage `/output`-respons voor seat A kan na de wissel de state van dezelfde `ChatPane`-instantie invullen terwijl `session` al seat B is; de UI toont dan A-output onder B en kan daarna berichten naar B sturen. **Voorgestelde fix:** gebruik een `AbortController` of per-effect request-id/`cancelled`-vlag en update state uitsluitend wanneer de actuele sessie/request nog overeenkomt; pas dit ook toe op de refresh na `send`.

3. **major** — `web/src/App.tsx:62-65`, `web/src/api.ts:70-79` — SSE-fouten en fouten in een door SSE getriggerde `loadFleet()`/`loadNeeds()` worden niet aan de gebruiker getoond. De promises worden bewust losgelaten (`void`), waardoor een tijdelijk kapotte server of ongeldig SSE-bericht als unhandled rejection of stil genegeerde invalidatie eindigt; de oude fleet/needs-you-lijst blijft zichtbaar zonder foutmelding. **Voorgestelde fix:** geef `subscribeToInvalidations` een error-callback/status, handel refresh-fouten af in `App` met dezelfde zichtbare retry-banner als `refresh`, en log/rapporteer malformed payloads in plaats van ze stil te negeren.

4. **major** — `web/src/api.ts:148-152`, `web/src/api.ts:174-178`, `web/src/api.ts:202-206` — Wave-2-mutaties typen de contractueel toegestane respons `{ error }` als `QueueItem`. Als de server die (met HTTP 200) retourneert, beschouwt de UI de mutatie als gelukt: de nieuwe-taakdialoog sluit, of de state/handoff refresht, zonder dat de fout wordt getoond. **Voorgestelde fix:** modelleer een discriminated error-response, controleer vóór succespad op `error`, gooi/rapporteer die fout, en laat de dialoog open met een `role="alert"`.

5. **major** — `web/src/RigManagement.tsx:64-68`, `web/src/RigManagement.tsx:91-101`, `web/src/RigManagement.tsx:245-276`, `web/src/RigManagement.tsx:310-331` — Meerdere rig/seat-acties en initiële reads hebben geen `catch` (o.a. snapshots/posture, model ophalen, launch/model switch, discovery scan/bind). Een HTTP-fout resulteert in een verworpen promise zonder toast of retry. Specifiek gooit `ConfirmDialog` bij een mislukte `down`/`restore`/`stop`; de dialoog blijft dan `busy` en sluit niet, zonder fouttekst. **Voorgestelde fix:** centraliseer async action-handling met try/catch/finally, toon het foutbericht in de betreffende view/dialoog, herstel altijd `busy`, en bescherm state-updates na unmount/rig- of seat-wissel.

6. **major** — `web/src/RigManagement.tsx:203-210` — Elke tussentijds ongeldige JSON-invoer in het posture-textarea (bijv. een gebruiker wist eerst een accolade) roept `JSON.parse` direct vanuit de React event-handler aan en gooit. Zonder error boundary kan dit de view onbruikbaar maken; de gebruiker krijgt geen valideerbare fout of herstelpad. **Voorgestelde fix:** bewaar de tekst apart, parse/valideer in een guarded handler of pas bij Save, toon parsefouten inline en disable Save totdat de JSON geldig is.

7. **minor** — `web/src/api.ts:245-255` — `savePosture` omzeilt `dashboardFetch`: het controleert `response.ok` niet. Een HTTP 4xx/5xx met JSON-body wordt vervolgens als ogenschijnlijk normale `ActionResult` verwerkt (of een niet-JSON-body gooit ongecontroleerd), in afwijking van de consistente foutafhandeling van alle overige contractcalls. **Voorgestelde fix:** gebruik `dashboardFetch<ActionResult>(..., { method: 'PUT', ... })`, zodat niet-successtatussen uniform zichtbaar falen.

8. **minor** — `web/src/RigManagement.tsx:91-98`, `web/src/RigManagement.tsx:245-250` — Asynchrone reads zijn niet race-safe. Wissel snel tussen rigs of seats terwijl snapshots/posture/model nog laden en een oude respons kan de state van de nieuw geselecteerde entiteit overschrijven. **Voorgestelde fix:** abort/versioneer reads in de effects en update alleen wanneer de actuele `rigId`/`session` nog matcht.

## Positief gecontroleerd

- De gespecificeerde session-segmenten gebruiken `encodeURIComponent`, ook voor `@`; dit geldt voor output, send, terminal-WS en wave-2/3 seat-routes.
- Needs-you gebruikt de contractuele `item.session` en opent de Terminal-tab; unresolved items krijgen geen terminalactie.
- Terminal-WS gebruikt `/dash/terminal/:session`, ruwe string-output en JSON voor toetsen/text; effect-cleanup sluit socket, timer, observer en xterm en verstuurt geen resize-frame.
- Destructieve down/restore/stop-acties vereisen in de UI exacte naam-invoer en tonen de extra waarschuwing voor `dashboard-team` respectievelijk `orch-lead@dashboard-team`.
- Geen `dangerouslySetInnerHTML` of client-side bearer/token gevonden; React/`pre` renderen API-tekst als tekst.

## Opvolging

1. opgelost in `web/src/TerminalPane.tsx` (`onScroll`, Live-knop en type-reset)
2. opgelost in `web/src/App.tsx` (`ChatPane` keyed op `session` en één alive-guard voor output en send-refresh)
3. opgelost in `web/src/api.ts` (`subscribeToInvalidations` onerror/malformed callback) en `web/src/App.tsx` (zichtbare SSE/load-fout)
4. opgelost in `web/src/api.ts` (`dashboardFetch` verwerpt `{ error }`)
5. opgelost in `web/src/RigManagement.tsx` (`runAction` voor rig/seat/discovery/new-rig-acties; dialogen tonen fouten en sluiten alleen na succes)
6. opgelost in `web/src/RigManagement.tsx` (postureText + guarded JSON-validatie)
7. opgelost in `web/src/api.ts` (`savePosture` via `dashboardFetch`)
8. opgelost in `web/src/RigManagement.tsx` (keyed rig/seat-componenten en alive-guards voor rig/model-reads en acties)

## Her-review

Hercontrole uitgevoerd op de huidige broncode, niet op de bovenstaande opvolgingsnotitie. `npm run build`, `npm run lint` en `VITE_MOCK=1 npm run build` slagen opnieuw.

1. **Bevestigd opgelost.** `web/src/TerminalPane.tsx:77-91` verstuurt nu `scroll`-frames met een afgeleide offset en biedt een expliciete Live-actie (`offset: 0`). Text/keys blijven JSON en er is geen resize-frame. Cleanup dispose't bovendien de scroll-listener. Geen dubbele sockets/reconnect-lus aangetroffen: per effect bestaat één socket en cleanup zet `disposed` vóór `close()`.

2. **Niet opgelost (major).** `web/src/App.tsx:388-406,417-431` zet `sessionRef.current` pas in een passieve `useEffect`. Na een render van seat B maar vóór die effect draait, kan een lopende A-output- of send-promise nog steeds zien dat de ref A is en B's state met A-output, notice, composer-tekst of `sending` overschrijven. Ook wordt bestaande output niet bij een sessiewissel gewist. **Fix:** abort/versioneer requests per sessie (en vergelijk de request-id), reset seatgebonden chatstate bij wissel, en guard alle state-writes van `send`; een ref die tijdens render of layout-effect wordt bijgewerkt is hooguit aanvullend.

3. **Bevestigd opgelost.** `web/src/api.ts:68-88` rapporteert malformed/SSE-fouten en `web/src/App.tsx:62-69` vangt fouten van invalidatie-refreshes zichtbaar af. De browser beheert SSE-reconnect zelf; er is geen extra handmatige reconnect-timer toegevoegd.

4. **Bevestigd opgelost.** `web/src/api.ts:25-33` parse't de respons eenmaal en verwerpt nu zowel niet-2xx-antwoorden als contractuele `{ error }`-antwoorden. Queue-mutaties bereiken daardoor de bestaande foutpaden en sluiten niet als succes.

5. **Niet opgelost (major).** De rig-refresh, confirm-dialoog en model-read zijn verbeterd, maar `web/src/RigManagement.tsx:320-343,376-398,423-426` laat nog steeds verworpen promises los voor seat launch/model switch, discovery scan/bind en new-rig creation. Bij een serverfout ziet de gebruiker geen fout/toast; New Rig sluit ook niet gecontroleerd. **Fix:** hergebruik één try/catch/finally action-wrapper met inline alert/toast en busy-state voor al deze mutaties.

6. **Bevestigd opgelost.** `web/src/RigManagement.tsx:239-270` bewaart de tekst, vangt parsefouten af, toont een alert en blokkeert Save totdat de invoer weer syntactisch geldige JSON is.

7. **Bevestigd opgelost.** `web/src/api.ts:253-262` gebruikt `dashboardFetch` voor de `PUT`-posturecall; HTTP-fouten volgen daarmee hetzelfde foutpad als de overige calls.

8. **Niet opgelost (minor).** `web/src/RigManagement.tsx:106-124,297-311` gebruikt wel guards, maar die worden pas in passieve effects geactiveerd. Een oude rig/model-response die landt tussen de render met een nieuwe `rigId`/`session` en de cleanup/effect kan nog door de oude guard komen en state overschrijven. **Fix:** abort/versioneer de fetches, of actualiseer de identity synchronisch vóór async-completions state kunnen zetten; reset model/snapshots/posture tijdens de wissel.

### Nieuwe bevindingen

1. **minor** — `web/src/api.ts:76-87`, `web/src/App.tsx:62-69` — Na herstel van SSE blijft de foutbanner permanent staan: `onerror` zet `error`, maar een later geldig event en een geslaagde `loadFleet`/`loadNeeds` wissen hem niet. De interface meldt dan nog “Connection interrupted; reconnecting…” terwijl de verbinding weer werkt. **Fix:** wis alleen de SSE-verbindingfout zodra een geldig event plus de relevante refresh lukt (zonder een onafhankelijke handmatige refresh-fout te maskeren).

2. **minor** — `web/src/RigManagement.tsx:242-266` — De posturevalidatie controleert alleen parsebaarheid. Geldige JSON zoals `null`, `[]` of `"tekst"` passeert en wordt via een type-cast als `Record<string, unknown>` verzonden, hoewel `effective` contractueel een object/map is. **Fix:** valideer dat de geparste waarde een niet-null, niet-array object is voordat Save activeert.

## Her-review opvolging

2. opgelost in `web/src/App.tsx` (`ChatPane` remount via `key={seat.session}` en alive-guard op alle async output/send state-writes)
5. opgelost in `web/src/RigManagement.tsx` (`runAction` herstelt busy in `finally` en wordt gebruikt voor launch, modelwissel, discovery scan/bind en rig-creatie; fouten staan in `role=alert`)
8. opgelost in `web/src/RigManagement.tsx` (`RigManagement`/`SeatManagement` remounten op identiteit en bewaken reads en acties met één alive-guard per component)
Nieuwe 1. opgelost in `web/src/App.tsx` (SSE-verbindingsfout wist na een geldig event en geslaagde scope-refresh; handmatige refreshfout blijft apart)
Nieuwe 2. opgelost in `web/src/RigManagement.tsx` (posture Save vereist een niet-null, niet-array JSON-object)

## Her-review 2

Hercontrole uitgevoerd op de actuele broncode. `npm run build`, `npm run lint` en `VITE_MOCK=1 npm run build` slagen opnieuw.

- **2 — bevestigd opgelost.** `web/src/App.tsx:394,401-445` geeft `ChatPane` nu `key={seat.session}`. Bij een seatwissel unmount de gehele chatinstantie, zodat output, composer, notice en sending-state niet naar de nieuwe seat kunnen lekken. De alive-guard voorkomt ook late updates op de oude instantie.
- **5 — bevestigd opgelost.** `web/src/RigManagement.tsx:18-42,362-400,444-483,489-535` voert launch/model, discovery scan/bind en rig-creatie via `runAction` uit. Verworpene requests krijgen een zichtbaar `role="alert"`, busy wordt in `finally` hersteld en New Rig sluit alleen na een fulfilled action-result.
- **8 — bevestigd opgelost.** `web/src/App.tsx:240-244,351,384-395` remount `RigManagement`, `SeatManagement`, Terminal, Queue en Chat op hun identiteit. In combinatie met de component-scoped alive-guards in `RigManagement.tsx:140-160,337-353` kan een response van een vorige rig/seat de actuele component niet meer invullen.
- **Nieuwe 1 — bevestigd opgelost.** `web/src/App.tsx:63-80` houdt request- en SSE-verbindingsfouten apart en wist de verbindingsfout na een geldig invalidate-event met geslaagde scope-refresh.
- **Nieuwe 2 — bevestigd opgelost.** `web/src/RigManagement.tsx:274-305` accepteert voor posture alleen een niet-null, niet-array JSON-object en blokkeert Save anders.

### Nieuwe bevinding

1. **major** — `web/src/RigManagement.tsx:32-40,98-108,320-325,413-417,516-524` — `runAction` en `ConfirmDialog` behandelen een fulfilled contractuele `ActionResult` met `{ ok: false }` als succes; alleen een verworpen promise geldt als fout. Scenario: de server wijst een destructive actie, rig-actie of rig-creatie af met de in CONTRACT.md gespecificeerde `{ ok: false, message }`. `ConfirmDialog` sluit dan ondanks de mislukking, en New Rig sluit via `onResult` eveneens. De toast meldt wel “Action failed”, maar de lokale actieflow en bevestigingsdialoog geven ten onrechte succes/verdwijnen. **Voorgestelde fix:** laat `runAction` en `ConfirmDialog` `result.ok === false` als foutpad verwerken (inline fout, dialoog openhouden, geen `onClose`), of laat de API-laag zulke resultaten consequent verwerpen.

## Her-review 2 opvolging

1. opgelost in `web/src/RigManagement.tsx` (`runAction` behandelt een fulfilled `ActionResult` met `ok: false` als inline fout vóór succescallbacks; `ConfirmDialog` controleert hetzelfde resultaat vóór `onClose`)
