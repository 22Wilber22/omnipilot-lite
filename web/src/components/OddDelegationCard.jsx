import { IconSpark } from './Icons.jsx';
import { StatusBadge } from './UiPrimitives.jsx';

const STATUS_VARIANT = {
  pendiente: 'wait',
  activo: 'info',
  completado: 'ok',
  fallido: 'fail',
  omitido: 'wait',
};

export default function OddDelegationCard({ delegation = [], isTerminal = false }) {
  if (!delegation.length) return null;

  const content = (
    <ul className="odd-list">
      {delegation.map(item => (
        <li key={item.phase} className={item.status === 'activo' ? 'odd-row active' : 'odd-row'}>
          <div className="between">
            <strong>{item.role}</strong>
            <StatusBadge variant={STATUS_VARIANT[item.status] || 'wait'}>{item.status}</StatusBadge>
          </div>
          <div className="odd-meta">
            <span>{item.provider}</span> · <span className="mono-inline">{item.permission}</span>
            {item.model ? <> · <span>{item.model}</span></> : null}
          </div>
          <p className="muted">Motivo: {item.reason}</p>
        </li>
      ))}
    </ul>
  );

  if (isTerminal) {
    return (
      <details className="fold-block">
        <summary><IconSpark /> Delegación ODD ({delegation.length} fases)</summary>
        {content}
      </details>
    );
  }

  return (
    <div className="odd-card">
      <div className="odd-head"><IconSpark /> <strong>Delegación ODD</strong></div>
      {content}
    </div>
  );
}
