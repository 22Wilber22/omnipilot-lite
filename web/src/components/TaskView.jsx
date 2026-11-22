import TooltipInfo from './TooltipInfo.jsx';

export const QUALITY_RULES = [
  {
    id: 'cleanCode',
    label: 'Código limpio',
    tip: 'Pide cambios pequeños, nombres claros y evita complejidad innecesaria.',
  },
  {
    id: 'focusedChanges',
    label: 'Cambios enfocados',
    tip: 'Limita el trabajo a los archivos necesarios para resolver la tarea.',
  },
  {
    id: 'runTests',
    label: 'Ejecutar pruebas',
    tip: 'Ejecuta la prueba de aceptación definida antes de marcar la tarea como completa.',
  },
  {
    id: 'singleFix',
    label: 'Un ciclo de corrección',
    tip: 'Si la prueba falla, Codex recibe el error y puede intentar una única corrección.',
  },
];

const ACCEPTANCE_OPTIONS = [
  { value: 'node --test password.test.js', label: 'Validación de contraseña' },
];

const PLAN_STEP_META = {
  implement: { icon: '1', label: 'Implementar con Codex', tip: 'Codex escribe los cambios necesarios dentro del workspace temporal.' },
  code: { icon: '1', label: 'Implementar con Codex', tip: 'Paso simulado de implementación en modo demostración.' },
  review: { icon: '2', label: 'Revisar con Antigravity', tip: 'Revisión en modo solo lectura. Si Antigravity no está disponible, Codex revisa en lectura.' },
  verify: { icon: '3', label: 'Verificar con pruebas locales', tip: 'Ejecuta el comando fijo de aceptación. Decide si la tarea pasa o falla.' },
  fix: { icon: '4', label: 'Corregir una vez si la prueba falla', tip: 'Si la prueba falla, Codex intenta una sola corrección antes de volver a verificar.' },
};

export default function TaskView({
  goal, setGoal,
  acceptance, setAcceptance,
  mode, setMode,
  quality, setQuality,
  run, agyAvailable,
  onCreatePlan, onApprove, onEditTask,
  busy, error,
}) {
  const toggleRule = (id) => setQuality(prev => ({ ...prev, [id]: !prev[id] }));

  if (run && run.status === 'pending') {
    return (
      <section className="card centered">
        <div className="between">
          <div>
            <h2 className="title-lg">Plan listo para revisar</h2>
            <p className="subtitle">{run.goal}</p>
          </div>
          <span className={run.mode === 'codex' ? 'badge ok' : 'badge wait'}>
            {run.mode === 'codex' ? 'Ejecución local real' : 'Modo demostración'}
          </span>
        </div>

        <ol className="plan-list">
          {run.plan.map((step, idx) => {
            const meta = PLAN_STEP_META[step.role] || { icon: String(idx + 1), label: step.title, tip: step.title };
            const title = step.role === 'review' && !agyAvailable && run.mode === 'codex'
              ? 'Revisar con Codex (fallback solo lectura)'
              : meta.label;
            return (
              <li key={step.id} className="plan-step">
                <span className="step-num">{idx + 1}</span>
                <span className="step-title">{title}</span>
                <TooltipInfo text={meta.tip} label={`Explicación de ${title}`} />
              </li>
            );
          })}
        </ol>

        <div className="actions-row">
          <button type="button" className="primary" onClick={onApprove} disabled={busy}>
            {busy ? 'Iniciando...' : 'Aprobar y ejecutar'}
          </button>
          <button type="button" className="secondary" onClick={onEditTask} disabled={busy}>
            Editar tarea
          </button>
        </div>

        {error && <p className="error" role="alert">{error}</p>}
      </section>
    );
  }

  return (
    <section className="card centered">
      <div className="between">
        <div>
          <h2 className="title-lg">¿Qué quieres construir?</h2>
          <p className="subtitle">OmniPilot crea un plan, coordina agentes y verifica el resultado.</p>
        </div>
        <span className={mode === 'codex' ? 'badge ok' : 'badge wait'}>
          {mode === 'codex' ? 'Ejecución local real' : 'Modo demostración'}
        </span>
      </div>

      <div className="field">
        <div className="label-row">
          <label htmlFor="task-goal">1. Objetivo</label>
          <TooltipInfo
            text="Describe el resultado que necesitas. OmniPilot usa este objetivo para crear un plan corto."
            label="Ayuda sobre objetivo"
          />
        </div>
        <textarea
          id="task-goal"
          rows="3"
          maxLength="1200"
          value={goal}
          onChange={e => setGoal(e.target.value)}
          placeholder="Implementar validatePassword para que pase la prueba de aceptación."
          disabled={busy}
        />
      </div>

      <div className="field">
        <div className="label-row">
          <label htmlFor="task-acceptance">2. Prueba de aceptación</label>
          <TooltipInfo
            text="La prueba decide si la tarea terminó correctamente. Los agentes no pueden cambiar este comando."
            label="Ayuda sobre prueba de aceptación"
          />
        </div>
        <select id="task-acceptance" value={acceptance} onChange={e => setAcceptance(e.target.value)} disabled={busy}>
          {ACCEPTANCE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>3. Perfil de calidad</label>
        <div className="quality-grid">
          {QUALITY_RULES.map(rule => (
            <label key={rule.id} className={quality[rule.id] ? 'quality-card active' : 'quality-card'}>
              <input
                type="checkbox"
                checked={Boolean(quality[rule.id])}
                onChange={() => toggleRule(rule.id)}
                disabled={busy}
              />
              <span>{rule.label}</span>
              <TooltipInfo text={rule.tip} label={`Ayuda sobre ${rule.label}`} />
            </label>
          ))}
        </div>
        <p className="muted">Estas reglas limitan el trabajo y el consumo de contexto.</p>
      </div>

      <div className="field mode-toggle-row">
        <label htmlFor="task-mode" style={{ margin: 0 }}>Modo</label>
        <select id="task-mode" value={mode} onChange={e => setMode(e.target.value)} disabled={busy}>
          <option value="codex">Ejecución local real (Codex)</option>
          <option value="demo">Modo demostración (simulado)</option>
        </select>
      </div>

      <button type="button" className="primary full" onClick={onCreatePlan} disabled={!goal.trim() || busy}>
        {busy ? 'Creando plan...' : 'Crear plan'}
      </button>
      <p className="muted center-text">El plan requiere tu aprobación antes de ejecutar agentes.</p>

      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
