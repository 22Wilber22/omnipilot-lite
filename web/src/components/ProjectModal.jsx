import { useEffect } from 'react';
import { IconClose } from './Icons.jsx';
import ProjectSelector from './ProjectSelector.jsx';

export default function ProjectModal({
  open, onClose, onConfirm,
  projectConfig, targetScope, setTargetScope,
  disabled,
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canConfirm = projectConfig.sourceType === 'template'
    || Boolean(projectConfig.project && projectConfig.acceptanceScript);

  return (
    <div className="drawer-backdrop" onClick={onClose} role="presentation">
      <aside className="drawer-panel" role="dialog" aria-modal="true" aria-label="Seleccionar proyecto" onClick={e => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h2>Proyecto de trabajo</h2>
            <p className="muted">Elige proyecto, prueba de aceptación y alcance opcional.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar selector de proyecto">
            <IconClose />
          </button>
        </div>

        <div className="drawer-body">
          <ProjectSelector
            sourceType={projectConfig.sourceType}
            onSourceTypeChange={projectConfig.onSourceTypeChange}
            projectPath={projectConfig.projectPath}
            onProjectPathChange={projectConfig.onProjectPathChange}
            project={projectConfig.project}
            acceptanceScript={projectConfig.acceptanceScript}
            onAcceptanceScriptChange={projectConfig.onAcceptanceScriptChange}
            onInspect={projectConfig.onInspect}
            inspecting={projectConfig.inspecting}
            disabled={disabled}
            error={projectConfig.error}
          />

          <section className="settings-block">
            <label htmlFor="target-scope">Archivo o área a trabajar (opcional)</label>
            <input
              id="target-scope"
              type="text"
              value={targetScope}
              onChange={e => setTargetScope(e.target.value)}
              placeholder="Ej. src/App.jsx, README.md o autenticación"
              autoComplete="off"
              disabled={disabled}
            />
            <p className="muted">Solo orienta al agente; el proyecto completo sigue siendo el límite de seguridad.</p>
          </section>

          <button type="button" className="primary full" onClick={onConfirm} disabled={!canConfirm || disabled}>
            Usar este proyecto
          </button>
        </div>
      </aside>
    </div>
  );
}
