export default function TooltipInfo({ text, label = 'Más información' }) {
  return (
    <span className="tip-wrap">
      <button type="button" className="tip-trigger" aria-label={label}>i</button>
      <span className="tip-box" role="tooltip">{text}</span>
    </span>
  );
}
