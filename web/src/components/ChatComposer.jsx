import { useRef } from 'react';
import { IconSend } from './Icons.jsx';

export default function ChatComposer({ value, onChange, onSend, disabled, sending }) {
  const inputRef = useRef(null);

  async function triggerSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled || sending) return;
    const accepted = await onSend(trimmed);
    if (accepted) {
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      triggerSend();
    }
  }

  return (
    <form
      className="composer"
      onSubmit={e => {
        e.preventDefault();
        triggerSend();
      }}
    >
      <textarea
        ref={inputRef}
        rows="2"
        maxLength="1200"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe qué quieres construir o pregunta por el estado de la tarea…"
        aria-label="Mensaje para OmniPilot"
        disabled={disabled || sending}
      />
      <div className="composer-foot">
        <span className="muted">Enter para enviar · Shift+Enter para nueva línea</span>
        <button
          type="submit"
          className="primary"
          disabled={disabled || sending || !value.trim()}
          aria-label="Enviar mensaje"
        >
          <IconSend /> {sending ? 'Enviando...' : 'Enviar'}
        </button>
      </div>
    </form>
  );
}
