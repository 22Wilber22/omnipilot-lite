import { IconSpark } from './Icons.jsx';
import { StatusBadge } from './UiPrimitives.jsx';

const LABELS = {
  active: { text: 'Activa', variant: 'ok' },
  installed: { text: 'Instalada', variant: 'info' },
  suggested: { text: 'Sugerida', variant: 'wait' },
};

export default function SkillCard({ skill, onToggle }) {
  const meta = LABELS[skill.status] || LABELS.suggested;
  return (
    <button
      type="button"
      className={`skill-card ${skill.status}`}
      onClick={() => onToggle(skill.id)}
      aria-label={`Cambiar estado de skill ${skill.name}`}
    >
      <div className="between">
        <strong className="skill-name"><IconSpark /> {skill.name}</strong>
        <StatusBadge variant={meta.variant}>{meta.text}</StatusBadge>
      </div>
      <p className="muted">{skill.description}</p>
    </button>
  );
}
