import { IconPlus } from './Icons.jsx';
import { StatusBadge } from './UiPrimitives.jsx';

const STATUS_META = {
  no_plan: { label: 'Sin plan', variant: 'wait' },
  plan_pending: { label: 'Plan pendiente', variant: 'wait' },
  running: { label: 'En ejecución', variant: 'info' },
  completed: { label: 'Completada', variant: 'ok' },
  failed: { label: 'Fallida', variant: 'fail' },
  cancelled: { label: 'Fallida', variant: 'wait' },
};

function formatTime(iso) {
  if (!iso) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return 'ahora';
  if (diffSec < 3600) return `hace ${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `hace ${Math.floor(diffSec / 3600)}h`;
  return iso.slice(0, 10);
}

export default function HistoryList({ items, activeId, connected, onNewTask, onSelect, busy }) {
  return (
    <div className="history-wrap">
      <button
        type="button"
        className="primary full"
        onClick={onNewTask}
        disabled={!connected || busy}
        aria-label="Crear nueva tarea"
      >
        <IconPlus /> Nueva tarea
      </button>

      {!connected && (
        <p className="muted">Conecta el token local en Ajustes para cargar tus chats.</p>
      )}

      {connected && items.length === 0 && (
        <p className="muted">Sin chats todavía. Escribe un mensaje o pulsa Nueva tarea.</p>
      )}

      <ul className="history-list">
        {items.map(item => {
          const meta = STATUS_META[item.status] || STATUS_META.no_plan;
          return (
            <li key={item.id}>
              <button
                type="button"
                className={item.id === activeId ? 'history-item active' : 'history-item'}
                onClick={() => onSelect(item.id)}
              >
                <span className="history-title">{item.title}</span>
                <span className="history-meta">
                  <StatusBadge variant={meta.variant}>{meta.label}</StatusBadge>
                  <span className="mono-time">{formatTime(item.updatedAt)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
