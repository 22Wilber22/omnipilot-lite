function statusBadge(info) {
  if (!info) return { text: 'Sin verificar', cls: 'badge wait' };
  return info.available
    ? { text: 'Disponible', cls: 'badge ok' }
    : { text: 'No disponible', cls: 'badge fail' };
}

export default function ProvidersView({ diagnostics, onRefresh, onContinue, busy }) {
  const codex = diagnostics?.codex;
  const agy = diagnostics?.antigravity;
  const codexBadge = statusBadge(codex);
  const agyBadge = statusBadge(agy);
  const agyOk = Boolean(agy?.available);
  const codexOk = Boolean(codex?.available);

  return (
    <section className="card centered">
      <div className="between">
        <div>
          <h2 className="title-lg">Proveedores detectados</h2>
          <p className="subtitle">Asistentes disponibles en este equipo para coordinar tus tareas.</p>
        </div>
        <button type="button" className="secondary" onClick={onRefresh} disabled={busy}>
          Actualizar
        </button>
      </div>

      <div className="provider-list">
        <article className="provider-item">
          <div className="between">
            <strong>Codex</strong>
            <span className={codexBadge.cls}>{codexBadge.text}</span>
          </div>
          <p className="muted">Implementación y corrección de código.</p>
          {!codexOk && codex && (
            <p className="warn-note">No detectado. Puedes usar Modo demostración para probar el flujo simulado.</p>
          )}
        </article>

        <article className="provider-item">
          <div className="between">
            <strong>Antigravity</strong>
            <span className={agyBadge.cls}>{agyBadge.text}</span>
          </div>
          <p className="muted">Planificación y revisión en modo solo lectura.</p>
          {!agyOk && agy && (
            <p className="warn-note">Fallback activo: Codex realizará la revisión en modo solo lectura.</p>
          )}
        </article>

        <article className="provider-item muted-card">
          <div className="between">
            <strong>IA local</strong>
            <span className="badge wait">Próximamente</span>
          </div>
          <p className="muted">Ejecución con modelos locales sin conexión externa.</p>
        </article>
      </div>

      <div className="auto-config">
        <h3>Configuración automática</h3>
        <ul>
          <li><span>Planificador</span><strong>{agyOk ? 'Antigravity' : 'Plan determinista local'}</strong></li>
          <li><span>Implementación</span><strong>Codex</strong></li>
          <li><span>Revisión</span><strong>{agyOk ? 'Antigravity' : 'Codex (modo lectura · fallback)'}</strong></li>
          <li><span>Verificación</span><strong>Pruebas locales</strong></li>
        </ul>
      </div>

      <button type="button" className="primary full" onClick={onContinue}>
        Continuar a nueva tarea
      </button>
    </section>
  );
}
