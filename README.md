# OmniPilot Lite — MVP local

**Estado:** prototipo funcional con demo local y flujo Codex experimental. El conector Codex y el orquestador tienen pruebas con procesos falsos; este endurecimiento no ejecutó Codex real. La UI continúa identificando la demostración como simulada.

## Inicio

Requiere Node.js 20+.

```bash
npm install
npm test
npm run dev
```

Abrir `http://127.0.0.1:5173`. Copiar el token de sesión que imprime el servidor Node en la terminal; pegarlo en la UI. Crear plan, aprobar y revisar los eventos. Cada ejecución guarda `workspaces/<uuid>/proyecto.json`, `events.jsonl`, `changes.patch` y una copia en `workspaces/<uuid>/project`.

## Proyectos locales

`PROJECTS_ROOT` limita los proyectos seleccionables y usa `~/OmniPilotProjects` por defecto. `POST /api/projects/inspect` recibe un `projectPath` relativo y devuelve nombre, ruta relativa, scripts e indicador Git sin ejecutar scripts. Una fuente `local-project` copia el proyecto al workspace, excluye dependencias, metadatos Git y secretos comunes, y acepta únicamente una clave existente de `package.json.scripts` como verificación.

## Lo que ya funciona

- Interfaz React, API local con token temporal y comprobación Host/Origin.
- Plan de tres pasos y enrutamiento por reglas.
- Memoria de ejecución en JSON con validación Zod y escritura atómica.
- Demostración claramente identificada de dos roles y transferencia de resumen.
- Ejecución real de pruebas de aceptación con `spawn`, sin shell.
- Timeout, salida acotada y cancelación del árbol de procesos. En macOS y Linux cada ejecución usa un grupo separado; Windows usa `taskkill /t /f` sin shell.
- Validación de rutas contra `workspaces/` con rechazo de escapes y symlinks en rutas existentes y contenido inspeccionado.
- Inspección y copia de proyectos confinados a `PROJECTS_ROOT`; el repositorio original permanece sin cambios.

## Lo que NO funciona todavía

- Primera corrida end-to-end del orquestador con Codex real: pendiente de autorización y verificación.
- Aislamiento fuerte: `cwd`, un repositorio Git temporal por ejecución y los flags `--sandbox` de Codex NO equivalen a un contenedor/VM ni garantizan aislamiento fuerte del sistema operativo. No ejecutar agentes no confiables sin controles adicionales.
- La estrategia de terminación con `taskkill` en Windows no se ha validado en esta Mac.
- Autenticación y uso comercial de las CLI: pendiente de verificar términos y capacidades oficiales.
- Persistencia/reanudación de ejecuciones tras reiniciar servidor.

## Seguridad

No se ejecutan comandos arbitrarios del usuario o generados por IA. El verificador usa el ejecutable Node y argumentos fijos. El token solo vive en la memoria de la pestaña; el servidor escucha exclusivamente en 127.0.0.1. No se guardan credenciales de proveedores. El modo demostración no accede a archivos fuera de su directorio de ejecución. El historial puede contener objetivos sensibles: no compartir `workspaces/`.

## Siguiente fase

Ejecutar una primera corrida real controlada desde un repositorio Git bajo `workspaces/`, revisar sus artefactos y mantener el modo experimental hasta aprobar esa evidencia.
