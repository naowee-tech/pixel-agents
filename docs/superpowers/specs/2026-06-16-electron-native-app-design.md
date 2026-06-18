# Pixel Agents — App nativa de escritorio (Electron)

- **Fecha:** 2026-06-16
- **Estado:** Aprobado (diseño)
- **Fork base:** https://github.com/naowee-tech/pixel-agents
- **Autor:** brainstorming colaborativo (superpowers:brainstorming)

## 1. Resumen

Reescribir Pixel Agents para que funcione como **app nativa de escritorio (Electron)** además
de su forma actual de extensión de VS Code, sin reescribir el núcleo. El proyecto ya está
estructurado con puertos limpios (`core/`), un cerebro standalone (`server/`) y una UI web
(`webview-ui/`) que **ya soporta modo browser por WebSocket**. La app nativa es esencialmente
un **wrapper Electron sobre el server standalone existente**, más relleno de los huecos que
requieren diálogos nativos y un sistema de **atención nativa del SO** cuando un agente espera
confirmación.

El stack standalone ya funciona hoy: `npx pixel-agents` (`server/src/cli.ts`) levanta Fastify
en modo `embedded:false`, sirve el SPA en `dist/webview`, expone `/ws` (WebSocket, sin auth,
bind a `127.0.0.1`), instala los hooks de Claude y escanea sesiones. `webview-ui/src/runtime.ts`
detecta la ausencia de `acquireVsCodeApi` y `webview-ui/src/transport/index.ts` selecciona
`WebSocketTransport` apuntando a `ws://${location.host}/ws`.

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Cascarón nativo | **Electron** (no Tauri). Razón: frontend Canvas 2D a 60fps necesita 1 engine consistente (Chromium); `core`/`server` ya son 100% Node, así que Tauri no podría soltar Node igualmente; `node-pty` (fase 2) cae directo en el main process. |
| Modelo de proceso | **In-process**: el server standalone corre dentro del proceso main de Electron (enfoque A). |
| Transporte | **WebSocket** (`WebSocketTransport` ya existe en `webview-ui`). Sin IPC para el flujo de datos. |
| Alcance de agentes | **Global con filtro opcional** por carpeta. |
| OS destino | **macOS primero**; Windows en una segunda etapa. |
| Terminal / "+ Agent" | **Fase 2** (híbrido): MVP es visor; terminal embebido (node-pty + xterm.js) después. |
| Huecos nativos | Resueltos con callbacks de host hacia diálogos Electron, sin tocar `webview-ui` salvo para los toggles de atención. |
| Atención nativa | Todas las señales (notificación SO, sonido SO, dock bounce, badge, menubar, traer al frente), **configurables en Settings**. |

## 3. Alcance

### Dentro (MVP)

- App Electron para macOS que arranca el server standalone in-process y abre una ventana al SPA.
- Visor completo reusando `webview-ui` sin cambios funcionales: oficina, agentes vía hooks/JSONL,
  editor de layout, settings, sonido in-app.
- Diálogos nativos: export/import de layout, agregar carpeta de assets, abrir carpeta de sesiones.
- Alcance global + filtro opcional por carpeta (server-side).
- Persistencia reusada bajo `~/.pixel-agents/` (namespace `electron` para agentes/seats;
  `layout.json` y `config.json` compartidos entre hosts).
- Shell nativo: menú de app, single-instance, persistencia de estado de ventana, shutdown limpio.
- **Sección de atención nativa** con toggles en Settings (Sección 12).

### Fuera (fase 2 y posteriores)

- Terminal embebido + botón "+ Agent" (node-pty + xterm.js) y `focusAgent` de terminal.
- Build/instalador de Windows.
- Firma de código y notarización para distribución pública.

## 4. Arquitectura

Se añade un adapter espejo de `adapters/vscode/`:

```
adapters/electron/
  main.ts          — Entry de Electron: ciclo de vida de app, single-instance,
                     arranque del server, creación de ventana.
  window.ts        — Creación de BrowserWindow + persistencia de tamaño/posición.
  menu.ts          — Menú nativo (incl. acciones de filtro/export/import).
  nativeBridge.ts  — Cablea callbacks de host del clientMessageHandler hacia
                     diálogos Electron (dialog.show*, shell.openPath).
  attention.ts     — Sistema de atención nativa (Sección 12).
  tray.ts          — Tray/menubar con contador de agentes esperando.
  config.ts        — Constantes (namespace, claves de window-state, defaults).
  tsconfig.json    — Config TS del adapter.
  package.json     — Deps de Electron + configuración de electron-builder.
```

Boundaries sin cambios: `core/` (puertos), `server/` (cerebro), `webview-ui/` (UI). El adapter
Electron solo (a) bootea el server, (b) hostea la ventana, (c) provee diálogos nativos por
callback, (d) dispara atención del SO escuchando el `AgentStateStore`.

**Flujo de datos:**

```
Electron main (Node)
  └─ startStandaloneServer()  (in-process)
       └─ Fastify: sirve SPA + /ws en 127.0.0.1:<puerto>
  └─ BrowserWindow.loadURL("http://127.0.0.1:<puerto>")
       └─ webview-ui detecta browser → WebSocketTransport → ws://127.0.0.1:<puerto>/ws
  └─ AgentStateStore.on('broadcast'|'agentAdded'|'agentRemoved') → attention.ts (SO)
```

webview-ui permanece intacto salvo la sección de toggles de atención en `SettingsModal.tsx`.

## 5. Refactor de bootstrap del server

`server/src/cli.ts` mezcla hoy arranque + parsing de argv + manejo de señales. Se extrae la lógica
reusable a un módulo nuevo:

```ts
// server/src/standalone.ts (nuevo)
export interface HostCallbacks {
  onExportLayout?: () => Promise<void> | void;
  onImportLayout?: () => Promise<void> | void;
  onPickAssetDir?: () => Promise<void> | void;
  onOpenPath?: (dir: string) => void;
}

export interface StandaloneHandle {
  server: PixelAgentsServer;
  runtime: AgentRuntime;
  store: AgentStateStore;
  config: ServerConfig;
}

export async function startStandaloneServer(opts: {
  distRoot: string;
  host?: string;
  port?: number;          // 0 = auto-asignar
  namespace?: string;     // 'standalone' (CLI) | 'electron' (app)
  hostCallbacks?: HostCallbacks;
}): Promise<StandaloneHandle>;

export function stopStandalone(handle: StandaloneHandle): void;
```

`cli.ts` queda como wrapper delgado: parsea argv, llama `startStandaloneServer({ namespace: 'standalone' })`
y registra `SIGINT`/`SIGTERM` → `stopStandalone`. Electron `main.ts` importa el mismo módulo con
`namespace: 'electron'` y `hostCallbacks` que abren diálogos nativos. Cero duplicación de la lógica
de arranque (assets, store, runtime, hooks, scanning).

Justificación de altitud: la lógica de arranque actual no es reusable por otro host; extraerla es
parte de hacer el trabajo en el código que estamos tocando.

## 6. Electron main y ciclo de vida

- `app.requestSingleInstanceLock()`. Si no se obtiene, la segunda instancia hace `app.quit()`;
  el evento `second-instance` enfoca la ventana existente.
- En `app.whenReady()`:
  1. `startStandaloneServer({ distRoot, port: 0, namespace: 'electron', hostCallbacks })`.
  2. Crear `BrowserWindow` con `contextIsolation: true`, `nodeIntegration: false`.
  3. `win.loadURL("http://127.0.0.1:" + handle.config.port)`.
  4. Adjuntar `attention.ts` a `handle.store`.
  5. Inicializar `tray.ts`.
- Reuso de server existente: `PixelAgentsServer.start()` ya detecta otro server vivo vía
  `~/.pixel-agents/server.json` + chequeo de PID y lo reutiliza (`ownsServer=false`). Si hay un
  server corriendo (p.ej. el CLI o VS Code), Electron solo abre la ventana hacia él.
- `window-all-closed`: en macOS la app permanece viva (patrón estándar); `activate` re-crea ventana.
- `before-quit`: `stopStandalone(handle)`. **No** desinstala los hooks de Claude (persisten para otros hosts).
- Namespace `electron` en `FileStateAdapter` → agentes/seats propios. `layout.json` y `config.json`
  se comparten con los demás hosts (misma oficina en todos lados).

## 7. Native bridge (huecos sin tocar webview-ui)

`webview-ui` ya emite estos mensajes por WS; hoy el `clientMessageHandler` standalone los ignora
(caso `default`). Se extiende `ClientMessageContext` con callbacks de host opcionales que el server
invoca al recibir el mensaje:

| Mensaje WS (ya emitido por la UI) | Callback | Acción en Electron |
|---|---|---|
| `exportLayout` | `onExportLayout()` | `dialog.showSaveDialog` → escribe JSON del layout actual. |
| `importLayout` | `onImportLayout()` | `dialog.showOpenDialog` → valida `version:1` + `tiles` array → `writeLayoutToFile` → `send({type:'layoutLoaded', layout})`. |
| `addExternalAssetDirectory` (sin `path`) | `onPickAssetDir()` | `dialog.showOpenDialog` (carpetas) → actualiza config → recarga assets → `send({type:'externalAssetDirectoriesUpdated', dirs})`. |
| `openSessionsFolder` | `onOpenPath(dir)` | `shell.openPath(dir)`. |

Se porta a standalone la lógica de "reload-and-send" de assets que hoy solo vive en
`PixelAgentsViewProvider` (`reloadAndSendFurniture`/`reloadAndSendCharacters`), para que tras
agregar/quitar una carpeta los assets se reenvíen al cliente conectado.

## 8. Alcance: global + filtro opcional

- Default: `pixel-agents.watchAllSessions = true` en el namespace `electron` → el runtime escanea
  todas las sesiones de Claude de la máquina.
- Filtro: menú nativo "Filter to folder…" → `dialog.showOpenDialog` (carpeta) → el server reconfigura
  el scan a ese project dir (`runtime.startProjectScan(dir)` + `watchAllSessions=false`). "Clear filter"
  vuelve a global (`watchAllSessions=true`).
- 100% server-side; `webview-ui` muestra lo que el server reporta. Sin cambios en la UI para esto.

## 9. Hooks (primer arranque)

`startStandaloneServer` instala los hooks de Claude si `pixel-agents.hooksEnabled` (default `true`),
igual que `cli.ts` hoy. El modal informativo de hooks ya existe en `webview-ui` (`hooksInfoShown`).
El toggle funciona vía WS + `onSetHooksEnabled`. No requiere nada nativo adicional.

## 10. Empaquetado y build

- `electron-builder`, targets macOS `dmg` + `zip`, arquitecturas `arm64` + `x64` (o universal).
- Se empaqueta `dist/` (cli/server, `webview`, `assets`, `hooks`) más las deps de Fastify
  (`fastify`, `@fastify/websocket`, `@fastify/static`, `@fastify/cors`) que `esbuild` externaliza.
- Nuevo target en `esbuild.js`: `buildElectronMain()` → bundle de `adapters/electron/main.ts` a
  `dist/electron-main.js` (CJS, externaliza `electron` + fastify).
- Scripts root nuevos:
  - `build:electron` — `npm run compile` + bundle electron-main + `electron-builder`.
  - `dev:electron` — arranca Electron apuntando a `dist/` con watch.
- macOS local: sin firma. Distribución pública → firma + notarización (etapa posterior).
- Windows (`nsis`/portable) → etapa 2.

`cli.ts` usa `__dirname` como `distRoot` y espera `dist/webview` (staticDir) + assets en `dist/`.
El empaquetado debe reproducir ese layout dentro de los recursos de la app y pasar `distRoot`
correcto a `startStandaloneServer`.

## 11. Manejo de errores

- Puerto ocupado: el server auto-asigna (`port: 0`). Si falla el bind → `dialog.showErrorBox` + quit.
- Server caído: la ventana muestra estado desconectado (el `WebSocketTransport` ya reconecta con
  backoff exponencial). El main detecta la caída y reinicia el server si murió.
- Assets faltantes: ya hay fallback (default layout bundleado); se registra en log.
- Falla de escritura en `~/.pixel-agents/` (permisos): `dialog` de aviso; la app sigue en modo lectura.

## 12. Atención nativa del SO

**Problema que resuelve:** cuando un agente o subagente espera confirmación y la ventana no tiene
foco, el usuario no se entera. Hoy solo hay una burbuja en la oficina + un chime in-app, fácil de
ignorar.

**Detección (ya existe en el cerebro):**

- Estado `permission` (burbuja ámbar "…"): el agente pide permiso para una acción. Vía hooks
  `PermissionRequest`/`Notification`, o el permission timer heurístico (7s sin datos).
- Estado `waiting` (check verde + chime): el turno terminó y espera el próximo prompt.
- Subagentes incluidos: una tool no-exenta en un subagente arranca el permission timer del padre;
  a los 5s sin datos aparecen burbujas en padre y subagente.

**Disparador:** el server corre en el proceso main de Electron, así que `attention.ts` se suscribe
directo al `AgentStateStore` (`store.on('broadcast')` y eventos de estado de agente). Sin tocar
`webview-ui`, sin WS adicional.

**Señales (todas configurables):**

| Señal | API Electron | Default | Solo si la app no tiene foco |
|---|---|---|---|
| Notificación SO | `new Notification()` (texto: agente + acción; click → enfoca ese agente) | ON | sí |
| Sonido SO | sonido del SO (independiente del chime in-app) | ON | sí |
| Dock bounce (macOS) | `app.dock.bounce('critical')` (rebota hasta enfocar) | ON | sí |
| Badge contador | `app.dock.setBadge(n)` (# agentes esperando) | ON | siempre refleja el conteo |
| Título menubar/tray | `Tray.setTitle(n)` | ON | siempre refleja el conteo |
| Traer ventana al frente | `win.show()` + `app.focus()` | **OFF** (intrusivo) | sí |

**Reglas:**

- Master toggle `pixel-agents.nativeAttentionEnabled` (ON) apaga todas las señales de golpe.
- Las señales "interrumpe" (notificación, sonido, bounce, traer al frente) solo disparan si
  `!win.isFocused()`. No molestan si el usuario ya está mirando la app.
- Badge y menubar reflejan el contador siempre; se limpian al resolver (click en burbuja, llegada
  de data, o nuevo turno).
- Debounce por agente para no spamear si el estado parpadea.
- Disparan tanto para `permission` como para `waiting` (ambos = "te necesita").

**Persistencia y flujo:**

- Claves nuevas en `FileStateAdapter` (namespace `electron`):

```
pixel-agents.nativeAttentionEnabled   (master)
pixel-agents.notify.osNotification
pixel-agents.notify.osSound
pixel-agents.notify.dockBounce
pixel-agents.notify.dockBadge
pixel-agents.notify.menubarCount
pixel-agents.notify.bringToFront
```

- Detección de host: el server incluye `host: 'electron' | 'standalone' | 'vscode'` en el mensaje
  `settingsLoaded`. La UI muestra la sección "Native Alerts" en `SettingsModal.tsx` **solo cuando
  `host === 'electron'`**.
- Toggle en UI → mensaje WS `set*` → `adapter.setSetting`. `attention.ts` lee `adapter.getSetting`
  en el momento de disparar cada señal.
- La lógica de atención vive en `adapters/electron/attention.ts` + `tray.ts`. webview-ui solo gana
  la sección de toggles.

## 13. Testing

- Unit `startStandaloneServer`: arranca, sirve el SPA, el `/ws` responde a `webviewReady` con el
  estado completo.
- Unit `nativeBridge`: cada callback abre el diálogo correcto (mock de `dialog`) y produce el mensaje
  WS esperado.
- Unit `attention.ts`: respeta foco (`win.isFocused`), respeta cada toggle, aplica debounce, limpia
  contador al resolver (mocks de `app`/`dock`/`Notification`/`Tray`).
- Reuso: los tests existentes de `server/` deben seguir verdes (el refactor de bootstrap no cambia
  comportamiento observable).
- E2E: Playwright Electron (ya usado para los e2e de VS Code) lanza la app, valida que la ventana
  carga y que un agente mock aparece en la oficina.
- Smoke manual macOS: `dev:electron`, correr `claude` en una terminal externa, ver el personaje
  aparecer y disparar una señal de atención con la ventana en background.

## 14. Fase 2 (preview, fuera del MVP)

Terminal embebido: panel xterm.js dentro del SPA + `node-pty` en el proceso main de Electron. El
botón "+ Agent" hace spawn de `claude --session-id <uuid>` en un pty, reutilizando una versión
adaptada de `agentManager`/`launchNewTerminal`. Se implementa `ITerminalAdapter` para Electron.
Requiere tocar `webview-ui` (panel de terminal), por eso es una fase separada.

## 15. Resumen de cambios por paquete

- `server/`: nuevo `standalone.ts` (extracción de `cli.ts`); `cli.ts` adelgazado; callbacks de host
  en `clientMessageHandler.ts`/`ClientMessageContext`; `host` en `settingsLoaded`; reload-and-send de
  assets portado a standalone.
- `adapters/electron/`: paquete nuevo completo (main, window, menu, nativeBridge, attention, tray,
  config).
- `webview-ui/`: sección "Native Alerts" en `SettingsModal.tsx` (visible solo en Electron) + nuevas
  claves de settings en el plumbing de mensajes.
- `esbuild.js`: target `buildElectronMain()`.
- root `package.json`: scripts `build:electron` / `dev:electron`; config electron-builder.
- `core/`: sin cambios (los puertos ya soportan esto).
</content>
</invoke>
