# Plan de sprints

## Sprint 1 · Conector Codex local — Completado

- **Objetivo:** comprobar que OmniPilot puede detectar y ejecutar Codex mediante un proceso local controlado.
- **Incluido:** `processRunner`, conector Codex, diagnóstico protegido con token local, pruebas unitarias y ejecución real en un repositorio Git descartable bajo `workspaces/`.
- **Validación:** `npm test` con 17/17 pruebas y respuesta real `OMNIPILOT_OK` con código 0 y JSONL legible.
- **Límite:** el orquestador continúa en modo demostración y no usa todavía el conector.
- **Resultado:** aprobado.

## Sprint 2 · Integración con el orquestador — Pendiente

- **Objetivo:** conectar las ejecuciones aprobadas de `createRun()` con Codex.
- **Tareas:** usar repositorios Git dentro de `workspaces/`, propagar cancelación y timeout, registrar eventos y conservar estados terminales coherentes.
- **Dependencias:** Sprint 1 completado.
- **Pruebas:** recorrido aprobado, fallo, timeout y cancelación sin regresiones de la demo.
- **Resultado esperado:** una ejecución real de Codex controlada por el orquestador.

## Sprint 3 · Experiencia y auditoría — Pendiente

- **Objetivo:** presentar el flujo real en la interfaz y auditar seguridad, aislamiento y recuperación.
- **Dependencias:** Sprint 2 aprobado sin errores críticos.
- **Resultado esperado:** recorrido visible y veredicto antes de ampliar proveedores o persistencia.

