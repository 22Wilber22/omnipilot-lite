import { IconSend } from './Icons.jsx';

const ACCEPTANCE_OPTIONS = [
  { value: 'node --test password.test.js', label: 'Validación de contraseña' },
];

export default function ChatComposer({ goal, setGoal, acceptance, setAcceptance, onSubmit, disabled, busy }) {
  return (
    <form
      className="composer"
      onSubmit={e => {
        e.preventDefault();
        if (!disabled && goal.trim() && !busy) onSubmit();
      }}
    >
      <textarea
        rows="2"
        maxLength="1200"
        value={goal}
        onChange={e => setGoal(e.target.value)}
        placeholder="Describe qué quieres construir o pregunta por el estado de la tarea…"
        disabled={busy}
      />
      <div className="composer-foot">
        <select value={acceptance} onChange={e => setAcceptance(e.target.value)} disabled={busy} aria-label="Prueba de aceptación">
          {ACCEPTANCE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <button type="submit" className="primary" disabled={disabled || !goal.trim() || busy} aria-label="Enviar tarea y crear plan">
          <IconSend /> {busy ? 'Creando...' : 'Enviar'}
        </button>
      </div>
    </form>
  );
}
