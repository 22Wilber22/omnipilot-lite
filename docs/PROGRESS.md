# Progreso

- **Sprint actual:** Sprint 1 cerrado y aprobado. Sprint 2 pendiente de inicio.
- **Completado:** `processRunner`, conector Codex, diagnóstico local protegido y prueba real desde un repositorio Git descartable dentro de `workspaces/`.
- **Prueba real:** código 0, 4559 ms, stdout JSONL legible, respuesta con `OMNIPILOT_OK`, sin timeout ni cancelación. Stderr contenía únicamente el aviso `Reading additional input from stdin...`.
- **Pruebas automatizadas:** `npm test` aprobado con 17/17 pruebas después de actualizar la documentación.
- **Seguridad verificada:** servidor en `127.0.0.1`, rutas `/api` protegidas con token local y Codex autenticado fuera de OmniPilot mediante `codex login`.
- **Pendiente:** integración del conector con `createRun()` en Sprint 2. El modo real del orquestador permanece deshabilitado.
- **Riesgos:** un workspace Git y `--cd` reducen el alcance operativo, pero no proporcionan aislamiento fuerte. La terminación de árboles de procesos en Windows sigue sin verificar.
- **Observación:** durante la prueba real no cambiaron archivos de la aplicación. macOS actualizó `.DS_Store`.

