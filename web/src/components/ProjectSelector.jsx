import { IconFile } from './Icons.jsx';

export default function ProjectSelector({
  sourceType,
  onSourceTypeChange,
  projectPath,
  onProjectPathChange,
  project,
  acceptanceScript,
  onAcceptanceScriptChange,
  onInspect,
  inspecting,
  disabled,
  error,
}) {
  const controlsDisabled = disabled || inspecting;

  return (
    <section className="project-picker" aria-labelledby="project-picker-title">
      <div className="project-picker-head">
        <div>
          <h2 id="project-picker-title">Proyecto de trabajo</h2>
          <p>Elige la plantilla integrada o una copia temporal de un proyecto local confiable.</p>
        </div>
        <IconFile />
      </div>

      <div className="source-options" role="radiogroup" aria-label="Fuente del proyecto">
        <label className={sourceType === 'template' ? 'source-option active' : 'source-option'}>
          <input
            type="radio"
            name="project-source"
            value="template"
            checked={sourceType === 'template'}
            onChange={() => onSourceTypeChange('template')}
            disabled={controlsDisabled}
          />
          <span>
            <strong>Plantilla de demostración</strong>
            <small>Usa la validación de contraseña incluida en OmniPilot.</small>
          </span>
        </label>
        <label className={sourceType === 'local-project' ? 'source-option active' : 'source-option'}>
          <input
            type="radio"
            name="project-source"
            value="local-project"
            checked={sourceType === 'local-project'}
            onChange={() => onSourceTypeChange('local-project')}
            disabled={controlsDisabled}
          />
          <span>
            <strong>Proyecto local</strong>
            <small>Trabaja sobre una copia dentro del workspace temporal.</small>
          </span>
        </label>
      </div>

      {sourceType === 'template' ? (
        <div className="project-field-grid">
          <label htmlFor="template-acceptance">Prueba de aceptación</label>
          <select id="template-acceptance" value="password-test" disabled={controlsDisabled} readOnly>
            <option value="password-test">Validación de contraseña integrada</option>
          </select>
        </div>
      ) : (
        <div className="local-project-fields">
          <p className="projects-root">Root permitido <code>~/OmniPilotProjects</code></p>
          <div className="inspect-row">
            <div className="project-path-field">
              <label htmlFor="local-project-path">Carpeta relativa</label>
              <input
                id="local-project-path"
                type="text"
                value={projectPath}
                onChange={event => onProjectPathChange(event.target.value)}
                placeholder="prueba-omnipilot"
                autoComplete="off"
                spellCheck="false"
                disabled={controlsDisabled}
              />
            </div>
            <button
              type="button"
              className="secondary"
              onClick={onInspect}
              disabled={controlsDisabled || !projectPath.trim()}
            >
              {inspecting ? 'Inspeccionando...' : 'Inspeccionar proyecto'}
            </button>
          </div>

          {error && <p className="error" role="alert">{error}</p>}

          {project && (
            <div className="project-inspection" aria-live="polite">
              <div className="between">
                <div>
                  <strong>{project.name}</strong>
                  <p className="muted mono-inline">{project.projectPath}</p>
                </div>
                <span className={project.isGitRepository ? 'badge ok' : 'badge wait'}>
                  {project.isGitRepository ? 'Repositorio Git' : 'Sin Git de origen'}
                </span>
              </div>
              <label htmlFor="local-acceptance">Prueba de aceptación</label>
              <select
                id="local-acceptance"
                value={acceptanceScript}
                onChange={event => onAcceptanceScriptChange(event.target.value)}
                disabled={controlsDisabled || project.scripts.length === 0}
              >
                <option value="">Selecciona un script</option>
                {project.scripts.map(script => <option key={script} value={script}>{script}</option>)}
              </select>
              {project.scripts.length === 0 && (
                <p className="error">Este package.json no contiene scripts disponibles.</p>
              )}
            </div>
          )}
        </div>
      )}

      <p className="copy-note">OmniPilot trabaja sobre una copia temporal. Tu proyecto original no se modifica.</p>
    </section>
  );
}
