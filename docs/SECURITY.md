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
- Flujo Codex del orquestador implementado con pruebas falsas. La primera corrida end-to-end con Codex real sigue pendiente.

## Límites

La ruta de trabajo, el repositorio Git y el sandbox de Codex reducen el alcance de la ejecución, pero no equivalen a aislamiento fuerte del sistema operativo. El proceso conserva los permisos disponibles para su sandbox y entorno. No se añade `--skip-git-repo-check`.

Los registros pueden contener objetivos o respuestas sensibles y deben mantenerse locales. La terminación de árboles está verificada en POSIX; la estrategia implementada para Windows sigue pendiente de validación en Windows.

