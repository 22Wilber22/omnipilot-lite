const LEVEL_META = {
  unavailable: { label: 'Uso no reportado por el proveedor', cls: 'empty' },
  idle: { label: 'Sin uso', cls: 'empty' },
  low: { label: 'Uso bajo', cls: 'ok' },
  medium: { label: 'Uso medio', cls: 'warn' },
  high: { label: 'Uso alto', cls: 'danger' },
  limit: { label: 'Límite alcanzado', cls: 'danger' },
};

export default function UsageBar({ usage, label = 'Consumo local' }) {
  const level = usage?.level ?? 'idle';
  const pct = usage?.pct ?? 0;
  const filled = level === 'unavailable' || level === 'idle' ? 0 : Math.max(1, Math.round(pct / 10));
  const meta = LEVEL_META[level] || LEVEL_META.idle;
  const hasNumbers = typeof usage?.tokens === 'number' && usage?.budget > 0;
  const tipText = hasNumbers
    ? `Presupuesto local de esta ejecución (${usage.tokens.toLocaleString()} / ${usage.budget.toLocaleString()} tokens). No representa la cuota restante de tu proveedor.`
    : 'Presupuesto local de esta ejecución. No representa la cuota restante de tu proveedor.';

  return (
    <div className="usage-wrap tip-wrap" tabIndex={0} aria-label={`${label}: ${meta.label}`}>
      <div className="usage-head">
        <span className="usage-label">{meta.label}</span>
        {level === 'limit' && <span className="badge fail">Límite</span>}
      </div>
      <div className="usage-segments" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={i < filled ? `seg ${meta.cls}` : 'seg'} />
        ))}
      </div>
      <span className="tip-box" role="tooltip">{tipText}</span>
    </div>
  );
}
