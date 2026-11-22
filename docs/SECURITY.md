# Seguridad — Estado real del prototipo

La aplicación escucha solamente en `127.0.0.1`. Todas las rutas `/api`, incluido `GET /api/diagnostics/codex`, requieren el token local temporal impreso por el servidor. También se comprueban Host y Origin.

Codex se autentica fuera de OmniPilot mediante `codex login`. OmniPilot no solicita, lee ni almacena credenciales del proveedor. El diagnóstico ejecuta únicamente `codex --version`.

## Controles implementados

- Ejecución con `spawn`, sin shell y con argumentos definidos por el conector.
- Timeout, cancelación, salida limitada y stdin cerrado.
- Sandbox configurable y `read-only` por defecto.
- Modo efímero y salida JSONL para la prueba real.
- Workspaces reales definidos como repositorios Git dentro de `workspaces/`.
- Modo real del orquestador deshabilitado hasta Sprint 2.

## Límites

La ruta de trabajo, el repositorio Git y `--cd` reducen el alcance de la ejecución, pero no constituyen aislamiento fuerte. El aislamiento efectivo depende también del sandbox de Codex y de los permisos del proceso. No se añade `--skip-git-repo-check`.

Los registros pueden contener objetivos o respuestas sensibles y deben mantenerse locales. La terminación de árboles de procesos está implementada para POSIX y sigue pendiente de validación en Windows.

