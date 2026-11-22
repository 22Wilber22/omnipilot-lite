export function StatusBadge({ variant = 'wait', children }) {
  return <span className={`badge ${variant}`}>{children}</span>;
}

export function AgentChip({ variant = '', icon, children }) {
  return (
    <span className={variant ? `agent-chip ${variant}` : 'agent-chip'}>
      {icon}
      {children}
    </span>
  );
}

export function ChatMessage({ role = 'assistant', author, meta, children }) {
  return (
    <div className={`msg ${role}`}>
      <div className="msg-head">
        <strong>{author}</strong>
        {meta}
      </div>
      {children}
    </div>
  );
}
