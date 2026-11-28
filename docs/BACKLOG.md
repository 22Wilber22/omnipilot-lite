# Backlog de OmniPilot Lite

| ID | Historia y tarea | Prioridad | Dependencias | Responsable | Archivos o módulos | Criterio y prueba | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OMNI-01 | Ejecutar procesos locales con argumentos controlados, timeout, cancelación y salida limitada. | P0 | Ninguna | odd-backend | `server/src/connectors/processRunner.js`, `server/test/processRunner.test.js` | Pruebas focalizadas aprobadas. | Completada |
| OMNI-02 | Detectar Codex y ejecutar un prompt mediante argumentos verificados. | P0 | OMNI-01 | odd-backend | `server/src/connectors/codexConnector.js`, `server/test/codexConnector.test.js` | Pruebas con procesos falsos y respuesta real `OMNIPILOT_OK` desde un workspace Git. | Completada |
| OMNI-03 | Exponer un diagnóstico local de disponibilidad de Codex. | P0 | OMNI-02 | odd-backend | `server/src/index.js` | `GET /api/diagnostics/codex` requiere token local y devuelve la versión disponible. | Completada |
| OMNI-04 | Integrar el conector Codex con las ejecuciones aprobadas del orquestador. | P0 | Sprint 1 | odd-backend | Orquestador, conector y pruebas | Una ejecución aprobada usa un repositorio Git bajo `workspaces/`, conserva eventos y termina con estado coherente. | Pendiente |
| OMNI-05 | Mostrar en la interfaz el estado y los errores de una ejecución real. | P1 | OMNI-04 | odd-frontend | `web/src/App.jsx` | Recorrido de creación, aprobación, progreso y error verificado. | Pendiente |
| OMNI-06 | Auditar aislamiento, cancelación y límites antes de ampliar proveedores. | P1 | OMNI-04 | odd-auditor | Runner, seguridad y pruebas | Veredicto explícito con pruebas focalizadas y riesgos residuales. | Pendiente |
| OMNI-07 | Registro de agentes respetado en selección y fallback (`AGENT_REGISTRY`, `antigravityUsable`, `assertAgentPermitted`). | P0 | OMNI-04 | odd-backend | `server/src/orchestrator/router.js`, `server/src/orchestrator/orchestrator.js`, `server/src/api/app.js`, `server/test/agentPermissions.test.js` | Commit `c113e88`; `117/117` tests en verde. | Completada |
| OMNI-08 | Corrida real E2E sobre copia temporal con verificación local aprobada. | P0 | OMNI-07 | odd-backend | `workspaces/` | Corrida real con Codex, Antigravity y verificación local sobre un commit >= `c113e88`. Antecedente: `fff3c9e4` (`2026-11-23`), solo Codex, anterior al cambio. | Pendiente |
| OMNI-09 | Unificar la decisión de fallback de escritura dentro de `routePhase`. | P1 | OMNI-07 | odd-backend | `server/src/orchestrator/router.js`, `server/src/orchestrator/orchestrator.js` | Selección y fallback centralizados en `routePhase` con pruebas unitarias. | Pendiente |
| OMNI-10 | Proveedores configurables en local (`enabled`, tarifa USD, `tokenBudget`) y tope de presupuesto en USD sobre `settingsStore`. | P1 | OMNI-07 | odd-backend / odd-frontend | `server/src/memory/settingsStore.js`, `server/src/metrics/usageTracker.js`, `server/src/orchestrator/orchestrator.js`, `web/src/components/SettingsDrawer.jsx` | Validación estricta con Zod, snapshot por run, corte `budget_usd_exceeded` y `costUsdPartial`. | Completada |

Sprint 1 cubre únicamente `processRunner`, el conector Codex, el diagnóstico local y la prueba real. La integración con `createRun()` comienza en Sprint 2.

