# OmniPilot Lite — MVP local

**Estado:** prototipo funcional en **modo demostración**. No ejecuta todavía Codex CLI ni Gemini CLI. La UI muestra explícitamente que los agentes son simulados. La verificación `node --test` sí ejecuta pruebas reales sobre un archivo generado de ejemplo.

## Inicio

Requiere Node.js 20+.

```bash
npm install
npm test
npm run dev
```

Abrir `http://127.0.0.1:5173`. Copiar el token de sesión que imprime el servidor Node en la terminal; pegarlo en la UI. Crear plan, aprobar y revisar los eventos. Cada ejecución guarda `workspaces/<uuid>/proyecto.json`, `events.jsonl` y un subdirectorio `workspace` con la función y sus pruebas.

## Lo que ya funciona

- Interfaz React, API local con token temporal y comprobación Host/Origin.
- Plan de tres pasos y enrutamiento por reglas.
- Memoria de ejecución en JSON con validación Zod y escritura atómica.
- Demostración claramente identificada de dos roles y transferencia de resumen.
- Ejecución real de pruebas de aceptación con `spawn`, sin shell.
- Timeout, salida acotada, cancelación y pruebas automatizadas del núcleo.

## Lo que NO funciona todavía

- Conectores reales Codex/Gemini: se habilitarán solo tras completar `docs/SPIKE.md` en el equipo del usuario.
- Aislamiento fuerte: `cwd`, un repositorio Git temporal por ejecución y los flags `--sandbox` de Codex NO equivalen a un contenedor/VM ni garantizan aislamiento fuerte del sistema operativo. No ejecutar agentes no confiables sin controles adicionales.
- Terminación fiable de árboles de procesos en Windows: pendiente de validación.
- Autenticación y uso comercial de las CLI: pendiente de verificar términos y capacidades oficiales.
- Persistencia/reanudación de ejecuciones tras reiniciar servidor.

## Seguridad

No se ejecutan comandos arbitrarios del usuario o generados por IA. El verificador usa el ejecutable Node y argumentos fijos. El token solo vive en la memoria de la pestaña; el servidor escucha exclusivamente en 127.0.0.1. No se guardan credenciales de proveedores. El modo demostración no accede a archivos fuera de su directorio de ejecución. El historial puede contener objetivos sensibles: no compartir `workspaces/`.

## Siguiente fase

Ejecutar `codex --version`, `gemini --version`, consultar sus ayudas y documentar los resultados en `docs/SPIKE.md`. No se inventarán flags. Después implementar adaptadores y verificar aislamiento/condiciones de uso antes de habilitar modo real.
