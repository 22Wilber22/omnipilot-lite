# PRD de OmniPilot Lite

## Visión y problema

Permitir que una persona desarrolladora revise un plan local, apruebe su ejecución y consulte evidencia de cómo se generó, revisó y verificó el resultado. El problema que aborda es la pérdida de contexto y trazabilidad entre implementación, revisión y pruebas.

## Usuarios y objetivos

El prototipo tiene un operador local que aporta un objetivo, aprueba y consulta resultados. Codex, Gemini y el verificador son roles del plan. Como objetivo de producto se propone demostrar un flujo repetible y auditable. Adopción, métricas de negocio y alcance comercial están por confirmar.

## Alcance confirmado y verificado

- La API Express escucha en loopback, valida Host y Origin y protege sus rutas de ejecución con token de sesión. La prueba HTTP confirmó el rechazo sin token y con Origin externo.
- Se verificó la creación de un plan fijo de tres pasos, su aprobación única, la ejecución de cuatro pruebas Node y la escritura de memoria JSON validada con Zod y registros JSONL.
- La demo usa un ejemplo fijo de validación de contraseñas y una revisión predefinida a partir de la memoria. El objetivo introducido se conserva como contexto.
- React y Vite presentan conexión, objetivo, plan, aprobación, cancelación y eventos por sondeo. La compilación pasó. La interacción en navegador queda pendiente. La API también ofrece SSE.
- Los identificadores y estados de ejecución viven en memoria. El disco conserva artefactos por ejecución. El proyecto carece de base de datos y de recuperación al reiniciar.

## Requisitos y criterios de aceptación

| ID | Estado | Requisito y criterio |
| --- | --- | --- |
| RF-01 | Verificado | Un objetivo no vacío de hasta 1200 caracteres crea un plan demo pendiente. Solo se ejecuta tras una aprobación y una segunda aprobación devuelve conflicto. |
| RF-02 | Verificado | Una demo completada enlaza implementación, revisión y verificación, produce cuatro pruebas aprobadas y guarda tres pasos en ambos artefactos. |
| RF-03 | Implementado parcialmente | El operador puede cancelar. Una cancelación efectiva debe quedar reflejada en el estado y los eventos. La prueba del flujo completo está pendiente. |
| RF-04 | Propuesto | Un fallo de preparación o escritura termina en un estado coherente y deja un diagnóstico consultable. |
| RNF-01 | Confirmado | Operación local con Node.js 20+, token temporal, acciones explícitas y verificación con argumentos fijos sin shell. |
| RNF-02 | Confirmado como requisito futuro | Antes de habilitar conectores, validar aislamiento efectivo, permisos, autenticación, manejo de secretos y terminación de procesos en plataformas objetivo. Un directorio de trabajo por sí solo carece de aislamiento. |

## MVP y decisiones abiertas

El MVP propuesto estabiliza la demo local y su ciclo de ejecución. Los conectores reales, la reanudación, el soporte Windows y el uso comercial quedan pendientes de decisión y evidencia. El modo real está bloqueado por la aplicación. El plan vigente es fijo y los artefactos pueden contener objetivos sensibles. El spike de CLI sigue sin resultados. El directorio Git detectado es el directorio personal y requiere acordar cómo versionar el proyecto.
