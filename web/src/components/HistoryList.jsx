import { IconPlus } from './Icons.jsx';
import { StatusBadge } from './UiPrimitives.jsx';

const STATUS_META = {
  pending: { label: 'Plan', variant: 'wait' },
  running: { label: 'En ejecución', variant: 'info' },
  completed: { label: 'Completada', variant: 'ok' },
  failed: { label: 'Fallida', variant: 'fail' },
  cancelled: { label: 'Fallida', variant: 'wait' },
};

export default function HistoryList({ items, activeId, onNewTask, onSelect }) {
  return (
    <div className="history-wrap">
      <button type="button" className="primary full" onClick={onNewTask} aria-label="Crear nueva tarea">
        <IconPlus /> Nueva tarea
      </button>

      <ul className="history-list">
        {items.map(item => {
          const meta = STATUS_META[item.status] || { label: 'Plan', variant: 'wait' };
          return (
            <li key={item.id}>
              <button
                type="button"
                className={item.id === activeId ? 'history-item active' : 'history-item'}
                onClick={() => onSelect?.(item)}
              >
                <span className="history-title">{item.title}</span>
                <span className="history-meta">
                  <StatusBadge variant={meta.variant}>{meta.label}</StatusBadge>
                  <span className="mono-time">{item.timeAgo}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="muted sidebar-note">
        Historial local de demostración. La persistencia entre sesiones se conectará al backend próximamente.
      </p>
    </div>
  );
}
