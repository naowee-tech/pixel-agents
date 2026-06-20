# Pixel Agents — Fase 2: Terminal embebida (Electron)

- **Fecha:** 2026-06-19
- **Estado:** Aprobado (diseño)
- **Branch base:** `feat/electron-native-app`
- **Fase previa:** [App nativa Electron](2026-06-16-electron-native-app-design.md) (§14 esboza esta fase)
- **Autor:** brainstorming colaborativo (superpowers:brainstorming)

## 1. Resumen

Fase 1 dejó la app Electron corriendo el server standalone in-process y mostrando el SPA por
WebSocket, pero el botón **"+ Agent" quedó oculto en modo browser/standalone** porque no hay
terminal con la cual interactuar (`BottomToolbar.tsx`: _"no terminal to interact with"_).

Fase 2 agrega una **terminal embebida real**: `node-pty` en el proceso main de Electron +
`xterm.js` en el webview. Esto permite **lanzar y operar agentes Claude dentro de la propia
app**, reemplazando la dependencia de las terminales de VS Code. La oficina pixel-art pasa de
ocupar toda la ventana a ser un sub-panel; la terminal del agente enfocado es el panel principal.

## 2. Principio central

La maquinaria de **JSONL-watching / estado de agente / animación de personajes no cambia**. Lo
único que cambia es la *fuente de terminal*: de `vscode.window.createTerminal` →
**`node-pty` en el main de Electron**.

- El **server** (in-process en el main) sigue siendo el dueño del estado de agente
  (`AgentStateStore`, `fileWatcher`, `timerManager`).
- **Electron** es el dueño del pty (proceso real del shell + claude).
- Se cablean vía **host callbacks**, el mismo patrón ya probado en `nativeBridge` (fase 1).

Justificación de altitud: el server orquesta (genera sessionId, construye comando, registra el
agente, observa el JSONL); Electron solo ejecuta el pty. Una sola fuente de verdad para el estado
de agente, sin duplicar la lógica de arranque ya extraída a `standalone.ts`.

## 3. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Layout | **Split 30/70**. Izquierda 30% (arriba tabs / abajo oficina, 50/50 vertical); derecha 70% = terminal del agente enfocado. |
| Paneles | **Redimensionables** con splitters arrastrables (los 2 divisores). **Tamaños persistidos**. Defaults iniciales: 30/70 (vertical), 50/50 (tabs/oficina). |
| Scope de tabs | **Todos los agentes** (app-spawned + externos detectados por el scan global). |
| Externos | Botón **"Reanudar aquí"** → `claude --resume <id>` en pty nuevo → se vuelve app-spawned en sitio (mismo JSONL/personaje). **Adoptar = adjuntar pty a agente externo existente.** |
| Focus | **Unificado**: clic en personaje (flujo `focusAgent`) **o** clic en tab → mismo efecto (selecciona agente → su terminal a la derecha + tab activo). |
| Restart | Los pty mueren con la app → todo vuelve **externo** → re-adoptar manual. **Cero auto-spawn, cero lógica de restore especial.** |
| Transporte I/O de terminal | **A — multiplex sobre el WS existente (`/ws`)**. Sin IPC, sin preload script. |
| Terminal real | El pty corre `$SHELL` interactivo y se le escribe el comando claude (no se spawnea claude directo) → terminal de verdad (prompt, Ctrl-C, otros comandos). |
| OS destino | **macOS primero** (consistente con fase 1). Windows pty → etapa posterior. |

## 4. Modelo de agente

- `AgentState` gana `ptyId?: string`. **"Tiene terminal viva" = `ptyId` seteado y proceso vivo.**
- Dos estados visibles por agente:
  - **App-spawned** (`ptyId` set): xterm en vivo en el panel derecho.
  - **Externo** (sin `ptyId`, surgido del scan global): panel derecho muestra placeholder +
    botón **"Reanudar aquí"**.
- Adopción no crea un agente nuevo: adjunta un pty a un agente externo existente. El mismo
  `<sessionId>.jsonl` se sigue observando; el personaje no cambia.

`ptyId` es **efímero**: no se persiste, muere con la app (ver §8 restart).

## 5. Layout webview (shell nuevo, solo `host==='electron'`)

```
┌───────────────┬──────────────────────────────────┐
│ AgentTabs     │                                  │
│ (todos los    │        TerminalPanel             │
│  agentes +    │     (agente enfocado)            │
│  status)      │     xterm.js + FitAddon          │
│  30% w · 50%h │        70% w                     │
├───────────────┤                                  │
│ OfficePanel   │   externo → placeholder +        │
│ (OfficeCanvas)│              "Reanudar aquí"      │
│  30% w · 50%h │                                  │
└───────────────┴──────────────────────────────────┘
  ↑ splitters arrastrables en ambos divisores; tamaños persistidos
```

- **`ElectronShell`** envuelve los 3 paneles. En **browser / VS Code** el SPA sigue **solo-oficina**
  (sin shell). El gating es por `host` (campo ya presente en `settingsLoaded`).
- **Paneles redimensionables** con `react-resizable-panels`: splitters en el divisor vertical
  (tabs+oficina | terminal) y el horizontal (tabs | oficina). Min/max razonables; tamaños
  **persistidos en `localStorage`** (UI electron-local). Defaults iniciales 30/70 y 50/50.
- **`focusedAgentId`** (estado del webview). Set por: clic en personaje (flujo `focusAgent`
  existente) **o** clic en tab. Ambos → mismo efecto.
- **Una instancia xterm por agente** en `Map<agentId, Terminal>`; solo la enfocada está
  montada/visible. El `terminalData` de los no-enfocados se escribe igual a su buffer en memoria,
  de modo que el **scrollback queda intacto** al cambiar de tab. Scrollback capado (~5000 líneas)
  para acotar memoria.
- **`+ Agent`** (`BottomToolbar`): hoy oculto en browser → **visible cuando `host==='electron'`**
  (mantiene folder picker + bypass permissions, ya implementados como mensaje `launchAgent`).

## 6. Transporte (A — multiplex sobre `/ws`)

Mensajes nuevos, definidos en `core/src/messages.ts` (+ schemas en `core/src/schemas.ts`):

| Dirección | Mensaje | Payload |
|---|---|---|
| Cliente → server | `launchAgent` | `{ folderPath?, bypassPermissions? }` |
| Cliente → server | `adoptAgent` | `{ agentId }` |
| Cliente → server | `terminalInput` | `{ agentId, data }` |
| Cliente → server | `terminalResize` | `{ agentId, cols, rows }` |
| Cliente → server | `removeAgent` | `{ agentId }` |
| Server → cliente | `terminalData` | `{ agentId, data }` |
| Server → cliente | `terminalError` | `{ agentId, message }` |

**Nota sobre focus:** el focus (qué xterm se muestra a la derecha) es **webview-local** —
`App.tsx` actualiza `focusedAgentId` ante el clic en un personaje o un tab. No requiere round-trip
al server. El mensaje `focusAgent` existente (que en VS Code revelaba la terminal de VS Code) es
no-op en Electron y no se agrega a este flujo.

`launchAgent` ya lo emite la UI hoy (cae en el `default` del `clientMessageHandler` standalone y se
ignora). Fase 2 lo cablea: solo hace algo cuando hay host callbacks de terminal presentes (es
decir, en Electron). El CLI standalone puro no tiene pty → callbacks ausentes → no-op (el botón
sigue oculto en browser).

El resize del TerminalPanel (por **drag del splitter o por resize de ventana**) → `FitAddon.fit()`
recalcula cols/rows → `terminalResize` (debounced) → `pty.resize`.

## 7. Flujo de spawn (server orquesta, Electron ejecuta el pty)

1. webview → `launchAgent { folderPath?, bypassPermissions? }`.
2. server: `sessionId = randomUUID()`; `cwd = folderPath || <filtro de carpeta activo> || homedir`;
   `cmd = buildLaunchCommand(sessionId, cwd, { bypassPermissions })`.
3. server → `hostCallbacks.onSpawnTerminal({ sessionId, cwd, command })` → **`terminalManager`**
   spawnea `$SHELL` interactivo en un pty, le escribe `cmd + '\r'`, y devuelve `ptyId`.
4. server: crea `AgentState` app-spawned con `ptyId`, **pre-registra el `<sessionId>.jsonl`
   esperado** en `knownJsonlFiles` para que el scan global **no lo duplique** como agente externo;
   arranca el poll-for-JSONL + file watching (reusa `server/src/fileWatcher.ts`). Broadcast
   `existingAgents` / estado.
5. `pty.on('data')` → `terminalManager.onData(ptyId, data)` → server `broadcast terminalData
   { agentId, data }` → xterm.

**Adopción** (`adoptAgent { agentId }`):

1. server toma `sessionId` + `projectDir` del agente externo.
2. `cmd = buildLaunchCommand(sessionId, cwd, { resume: true })` (= `claude --resume <id>`).
3. `onSpawnTerminal` → `ptyId`; el server marca el agente como app-spawned y le setea `ptyId`;
   broadcast. El watch de JSONL existente continúa sin interrupción.

`buildLaunchCommand` (en `server/src/providers/hook/claude/claude.ts`) se **extiende con
`{ resume?: boolean }`**: cuando `resume` es true usa `--resume <sessionId>` en lugar de
`--session-id <sessionId>`.

## 8. terminalManager (`adapters/electron/terminalManager.ts`, nuevo)

API:

```ts
interface TerminalManager {
  spawn(opts: { sessionId: string; cwd: string; command: string }): string; // → ptyId
  write(ptyId: string, data: string): void;
  resize(ptyId: string, cols: number, rows: number): void;
  kill(ptyId: string): void;
  onData(cb: (ptyId: string, data: string) => void): void;
  onExit(cb: (ptyId: string, code: number) => void): void;
}
```

- Mantiene `Map<ptyId, IPty>`. Cableado en `main.ts` a los host callbacks (junto a `nativeBridge`).
- El pty corre el login shell (`$SHELL` o fallback) en modo interactivo, no `claude` directo: el
  usuario ve un prompt real y puede `Ctrl-C` / correr otros comandos. Claude es lo que el server
  hace correr escribiendo el comando.
- Resize vía `FitAddon` (webview) → `terminalResize` → `pty.resize`.

## 9. Persistencia / restart

- `ptyId` **no se persiste** (efímero). En `before-quit` → `kill` de todos los pty.
- El server persiste los agentes (namespace `electron`) como hoy; al reabrir, el scan global los
  re-surfacea como **externos**. Re-adoptar manual con "Reanudar aquí".
- **Cero lógica de restore especial** — el comportamiento de restart cae solo del modelo de
  adopción.

## 10. Manejo de errores

- **Spawn falla** (claude no en PATH, shell ausente) → `terminalError { agentId, message }` →
  el panel muestra el error; se descarta el agente a medio crear.
- **pty exit** (claude/shell cierra) → `onExit` → el server quita el `ptyId`; el agente vuelve
  externo/read-only (el personaje sigue, el JSONL sigue) → el tab vuelve a mostrar "Reanudar aquí".
- **Conflicto de adopción** (`--resume` sobre una sesión viva en otra terminal, ej. iTerm): no es
  detectable de forma fiable → documentado. Adoptar conviene en sesiones idle/terminadas; si claude
  tira error, `terminalError` lo muestra y el usuario cierra.
- **Backpressure**: `pty.on('data')` **coalesce** (flush en ≤16ms o tras N bytes) antes de hacer
  broadcast → evita inundar el WS en outputs grandes (`cat archivo`). xterm escribe chunked sin
  problema.
- **Resize storms**: `terminalResize` debounced.

## 11. Empaquetado (⚠ módulo nativo)

- **`node-pty` es un módulo nativo** → debe recompilarse para el ABI de Electron
  (`electron-builder` `npmRebuild` / `@electron/rebuild`). El binario prebuilt de node-pty va en
  `asarUnpack`. El bundle de `esbuild` para electron-main lo **externaliza** (igual que fastify).
- **`xterm.js`** (`@xterm/xterm`) + **`@xterm/addon-fit`** + **`react-resizable-panels`**: JS puro
  en `webview-ui`, Vite los bundlea normalmente.
- macOS primero. Windows pty (ConPTY) → etapa posterior.

## 12. Testing

- **Unit `terminalManager`** (mock de `node-pty`): `spawn` arma el comando correcto y escribe al
  pty; `write`/`resize`/`kill` forwardean; `onData`/`onExit` emiten.
- **Unit server `launchAgent` / `adoptAgent`** (mock de `onSpawnTerminal`): registra el agente,
  pre-registra el JSONL, setea el flag app-spawned; adopt adjunta el pty a un externo existente;
  `terminalInput` / `terminalResize` rutean al host.
- **Unit `clientMessageHandler`**: los casos nuevos rutean a los callbacks correctos y producen los
  broadcasts esperados (relay de `terminalData`).
- **Webview**: `ElectronShell` renderiza los 3 paneles solo cuando `host==='electron'`; focus por
  tab/personaje setea `focusedAgentId`; `TerminalPanel` monta xterm para un agente vivo y
  placeholder+botón para uno externo; el drag del splitter persiste tamaños y dispara
  `FitAddon`+`terminalResize`.
- **E2E Playwright Electron**: stub de `claude` (script dummy en PATH) → `+ Agent` → aparece un tab
  + output en la terminal + el personaje anima.
- **Reuso**: los tests existentes de `server/` y `adapters/electron/` deben seguir verdes.

## 13. Resumen de cambios por paquete

- **`adapters/electron/`**: `terminalManager.ts` (nuevo); wiring en `main.ts` de
  `onSpawnTerminal` / `onTerminalInput` / `onTerminalResize` / `onKill` y del relay `onData`/`onExit`;
  `package.json` gana `node-pty` + config de rebuild nativo / `asarUnpack` en electron-builder.
- **`server/`**: `launchAgent` / `adoptAgent` (orquestación de spawn + registro) en la capa
  standalone; nuevos casos en `clientMessageHandler.ts` (`launchAgent`, `adoptAgent`,
  `terminalInput`, `terminalResize`, `removeAgent`, `focusAgent`); broadcast de `terminalData` /
  `terminalError`; `AgentState` gana `ptyId` + flag app-spawned; pre-registro del JSONL al spawnear;
  `buildLaunchCommand` extendido con `{ resume? }`.
- **`webview-ui/`**: `ElectronShell` (layout de 3 paneles redimensionables, gated a electron),
  `AgentTabs`, `TerminalPanel` (xterm + FitAddon + placeholder/"Reanudar aquí"); wiring de
  `focusedAgentId`; mensajes nuevos (`terminalData`/`terminalInput`/`terminalResize`/`launchAgent`/
  `adoptAgent`/`terminalError`); des-ocultar `+ Agent` para electron; deps `@xterm/xterm`,
  `@xterm/addon-fit`, `react-resizable-panels`.
- **`core/`**: `messages.ts` + `schemas.ts` ganan los tipos/schemas de los mensajes de terminal.
- **`esbuild.js` / packaging**: externalizar `node-pty`; config de rebuild nativo.

## 14. Fuera de alcance (YAGNI)

- pty de Windows (ConPTY) y empaquetado Windows.
- Temas / búsqueda / perfiles de terminal; múltiples shells.
- Varias terminales por un mismo agente.
- Auto-resume de agentes al arrancar la app (queda como posible toggle futuro).
</content>
</invoke>
