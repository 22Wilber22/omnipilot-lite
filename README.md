# OmniPilot Lite

Orquestador **local-first** con flujo **ODD (Orchestrator-Driven Development)** para conversar, planificar, delegar cambios en una copia temporal y verificar con pruebas locales preaprobadas antes de exportar evidencia y parche Git.

## Requisitos

- Node.js 20+
- Opcional para ejecución real de agentes: `codex` CLI y/o `agy` (Antigravity CLI) instalados localmente.

## Inicio rápido

```bash
npm install
npm test
npm run build
npm run dev
```

1. Abre `http://127.0.0.1:5173`.
2. Copia el **TOKEN LOCAL** que imprime el backend (`http://127.0.0.1:4317`) en **Ajustes → Conexión local**.
3. Conversa normalmente con el orquestador (solo lectura).
4. Cuando quieras pasar a código, elige un proyecto en **Elegir proyecto** (confinado a `PROJECTS_ROOT`, por defecto `~/OmniPilotProjects`), pulsa **Convertir en tarea** y luego **Aprobar y ejecutar**.

## Flujo ODD y seguridad

- **Copia temporal aislada:** cada ejecución trabaja en `workspaces/<uuid>/project`; el proyecto original nunca se modifica.
- **Preflight y prueba base:** si el proyecto tiene `package-lock.json`, instala dependencias en la copia (`npm ci --ignore-scripts` por defecto, o `npm ci` solo con aprobación explícita) y ejecuta la prueba base antes de llamar agentes.
- **Scripts de aceptación inmutables:** solo se permiten scripts de la allowlist (`test`, `test:unit`, `test:integration`, `lint`, `check`, `build`). Se valida hash de `package.json` y `package-lock.json` antes de cada verificación.
- **Fallback automático:** en chat (`auto`) y en implementación/corrección, si un proveedor falla o agota cuota/timeout, cambia automáticamente al otro proveedor local disponible y registra el motivo en **Delegación ODD**.
- **Evidencia y parche descargables:** `GET /api/runs/:id/evidence` (JSON saneado con `redact()`) y `GET /api/runs/:id/patch` (`.diff` excluyendo `node_modules`, `.git` y `.env`).
- **Sin secretos en disco ni en URL:** autenticación por header `X-Omni-Token`, validación `Host`/`Origin` en `127.0.0.1`, `spawn` sin `shell:true` y timeouts estrictos.

## Scripts

- `npm run dev` — levanta backend (`4317`) y frontend Vite (`5173`).
- `npm test` — ejecuta la suite completa de Vitest.
- `npm run build` — genera el bundle de producción en `dist/web`.

## Límites conocidos

- Los sandboxes locales de CLI y `workspaces/` no equivalen a un contenedor/VM del sistema operativo.
- La exportación completa del workspace está desactivada por diseño (solo se exportan evidencia JSON y parche `.diff`).
- La barra de consumo muestra **Uso observado** en la ejecución actual, no la cuota restante real de la cuenta del proveedor.
