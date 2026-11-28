# Seguridad — Estado real del prototipo

La aplicación escucha solamente en `127.0.0.1`. Todas las rutas `/api`, incluido `GET /api/diagnostics/codex`, requieren el token local temporal impreso por el servidor. También se comprueban Host y Origin.

Codex se autentica fuera de OmniPilot mediante `codex login`. OmniPilot no solicita, lee ni almacena credenciales del proveedor. El diagnóstico ejecuta únicamente `codex --version`.

## Controles implementados

- Ejecución con `spawn`, sin shell y con argumentos definidos por el conector.
- Timeout, cancelación del árbol completo, salida limitada y stdin cerrado.
- Grupos de procesos separados en macOS y Linux, con una prueba que confirma la terminación de un hijo real. Windows usa `taskkill /t /f` mediante `spawn` y `shell: false`; esa rama no se ha validado en esta Mac.
- Sandbox configurable y `read-only` por defecto.
- Modo efímero y salida JSONL para la prueba real.
- Workspaces reales definidos como repositorios Git dentro de `workspaces/`. El guard rechaza `..`, rutas absolutas o externas y symlinks en rutas existentes o dentro del workspace inspeccionado usando `lstat` y `realpath`.
- Proyectos fuente limitados a rutas relativas bajo `PROJECTS_ROOT`, resueltas con `realpath` y rechazadas si contienen escapes o symlinks incluidos. La copia omite `node_modules`, `.git`, `.env`, configuraciones de credenciales y extensiones comunes de claves.
- Scripts de aceptación seleccionados exclusivamente por nombre entre las claves de `package.json.scripts`; la ejecución usa `npm run <nombre-validado>` con `shell: false`.
- Parche de evidencia calculado con Git desde el commit baseline de la copia temporal. El proyecto fuente nunca se usa como directorio de ejecución.
- Registro de agentes (`server/src/orchestrator/router.js`, `AGENT_REGISTRY`):

| Agente (`id`) | Capabilities | Permisos permitidos |
| --- | --- | --- |
| `codex` | `code-write`, `code-read`, `fix` | `workspace-write`, `read-only` |
| `antigravity` | `plan`, `review`, `chat`, `code-write`, `fix` | `read-only`, `accept-edits` |
| `local-verifier` | `verify` | `local-fixed-command` |

- Regla de escritura (`canAgentRun`): tanto `accept-edits` como `workspace-write` exigen la capability `code-write`. Antigravity nunca tiene `workspace-write`.
- Doble control en `runCodexFlow` (`server/src/orchestrator/orchestrator.js`): `antigravityUsable` decide el fallback consultando `canAgentRun` antes de `isAvailable()`, y `assertAgentPermitted` bloquea justo antes de cada llamada a `codex.run` o `antigravity.run`. Si el registro niega un fallback, `antigravityUsable` devuelve `false` sin emitir evento y el flujo sigue su camino alternativo (revisión → Codex `read-only`; implement/fix → sin fallback, falla con el error de Codex). Si una llamada llega a `assertAgentPermitted` y el registro la niega, se emite `step.failed` con `reason: "agent_not_permitted"` y el conector no se invoca.
- Decisión explícita sobre Antigravity: puede editar (`--mode accept-edits --sandbox`) solo como fallback de implementación y `fix` cuando Codex falla. La revisión sigue en `--mode plan` (`read-only`).

## Límites

La ruta de trabajo, el repositorio Git y el sandbox de Codex reducen el alcance de la ejecución, pero no equivalen a aislamiento fuerte del sistema operativo. El proceso conserva los permisos disponibles para su sandbox y entorno. No se añade `--skip-git-repo-check`.

- `routePhase` todavía no recomienda Antigravity para implementación; el fallback de escritura lo decide el orquestador (`runCodexFlow`).
- `AGENT_REGISTRY` es estático en código: no existe ninguna vía (archivo, variable de entorno o API) para ampliar capabilities o permisos desde configuración. `settings.json` solo admite `enabled`, `usdPer1kTokens`, `tokenBudget` y `runBudgetUsd` con validación Zod `.strict()`.
- El costo en USD mostrado en UI y usado para `budget_usd_exceeded` es una estimación local calculada desde tokens reportados × tarifa configurada; si algún proveedor usado tiene tarifa `0`, se marca como `costUsdPartial: true` y no se corta por USD.
- Corrida real posterior a `c113e88`: pendiente. La última corrida real (`fff3c9e4`, `2026-11-23`) es anterior a ese commit y solo usó Codex + `local-verifier`; no valida el registro ni el fallback a Antigravity.

Los registros pueden contener objetivos o respuestas sensibles y deben mantenerse locales. La terminación de árboles está verificada en POSIX; la estrategia implementada para Windows sigue pendiente de validación en Windows.

