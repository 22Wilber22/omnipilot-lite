export default function RoleSelect({ id, label, value, options, onChange, lockedText, note }) {
  return (
    <div className="role-row">
      <div>
        <label htmlFor={id} className="role-label">{label}</label>
        {note && <p className="muted">{note}</p>}
      </div>
      {lockedText ? (
        <span className="locked-pill">{lockedText}</span>
      ) : (
        <select id={id} value={value} onChange={e => onChange(e.target.value)} aria-label={label}>
          {options.map(opt => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
