# F0 — Viabilidad de CLI

Fecha de cierre de Sprint 1: 2026-11-22

## Entorno
- SO y versión:
- `node --version`: `v20.17.0`
- `npm --version`: `10.8.2`
- `codex --version`: `codex-cli 0.171.0`
- `gemini --version`:

## Codex CLI
- Ayuda de la CLI (`codex --help` y `codex exec --help`): verificada localmente.
- Subcomando no interactivo: `codex --ask-for-approval never exec --cd <workspace-git> --sandbox read-only --ephemeral --json <prompt>`.
- Autenticación: comprobada mediante `codex login status`. Se configura fuera de OmniPilot con `codex login`.
- Directorio de trabajo: repositorio Git descartable dentro de `workspaces/`.
- Formato de salida: JSONL legible.
- Evidencia: respuesta real `OMNIPILOT_OK` mediante `codexConnector.run()`.

## Gemini CLI
- Ayuda oficial (`gemini --help`):
- Modo no interactivo, sintaxis EXACTA:
- Autenticación oficial comprobada por usuario: Sí / No
- Directorio de trabajo y permisos/sandbox:
- Formato de salida:
- Evidencia de ejecución:

## Pruebas por CLI
| Prueba | Codex | Gemini |
|---|---|---|
| Termina con código 0 | Aprobado | Pendiente |
| Timeout | Aprobado con proceso falso | Pendiente |
| Cancelación | Aprobado con proceso falso | Pendiente |
| Sin procesos huérfanos | Pendiente | Pendiente |
| Espera aprobación detectada | Pendiente | Pendiente |
| Repositorio Git temporal bajo `workspaces/` | Aprobado | Pendiente |
| Salida recuperable | Aprobado | Pendiente |

**Importante:** `probe.mjs` NO mata árboles de procesos. El resultado de esta prueba determina el diseño posterior de `processRunner.js`.

## Decisión Go/No-Go
- [ ] Ambas CLI viables
- [ ] Solo una viable (Plan B declarado)
- [ ] Ninguna viable: cambiar alcance

## Riesgos legales
Revisar documentación y términos oficiales actuales antes de comercializar. No asumir que una suscripción autoriza cualquier integración.

## Prueba manual Codex (Sprint 1)

**Resultado:** aprobado el 2026-11-22.

- Código de salida: `0`.
- Duración: `4559 ms`.
- stdout: JSONL legible con mensaje final `OMNIPILOT_OK`.
- stderr sanitizado: `Reading additional input from stdin...`.
- Timeout: no.
- Cancelación: no.

Sprint 1 queda completado para `processRunner`, el conector Codex, el diagnóstico local y esta prueba real. La integración con `createRun()` corresponde a Sprint 2.

Prerrequisitos: `codex login` ejecutado fuera de OmniPilot y un repositorio Git temporal creado dentro de `workspaces/`.

1. **Verificar diagnóstico local vía API** (con el servidor corriendo en `127.0.0.1:4317` y el token impreso en consola):
   ```bash
   curl -sS -H "X-Omni-Token: <TOKEN_LOCAL>" http://127.0.0.1:4317/api/diagnostics/codex
   ```
   Esperado: `{"provider":"codex","available":true,"version":"...","error":null}`.

2. **Ejecutar el prompt trivial en el workspace de prueba** (usa `shell: false`, `stdin` cerrado y los argumentos verificados):
   ```bash
   node -e "import('./server/src/connectors/codexConnector.js').then(async ({ codexConnector }) => { const res = await codexConnector.run('Responde únicamente OMNIPILOT_OK.', { workspace: process.cwd() + '/workspaces/manual-codex-test', sandbox: 'read-only', timeoutMs: 30000 }); console.log(JSON.stringify({ ok: res.ok, code: res.code, output: res.output, timedOut: res.timedOut, cancelled: res.cancelled, ms: res.ms }, null, 2)); })"
   ```
   Esperado: `ok: true`, `code: 0`, `output: "OMNIPILOT_OK"`.
