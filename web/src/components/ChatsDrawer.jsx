import { useEffect, useRef } from 'react';
import { IconClose, IconSettings } from './Icons.jsx';
import HistoryList from './HistoryList.jsx';

export default function ChatsDrawer({
  open,
  onClose,
  returnFocusRef,
  items,
  activeId,
  connected,
  onNewTask,
  onSelect,
  onOpenSettings,
  busy,
}) {
  const closeBtnRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    closeBtnRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      returnFocusRef?.current?.focus();
    };
  }, [open, onClose, returnFocusRef]);

  if (!open) return null;

  return (
    <div className="drawer-backdrop drawer-left" onClick={onClose} role="presentation">
      <aside
        id="chats-drawer"
        className="drawer-panel drawer-panel-left"
        role="dialog"
        aria-modal="true"
        aria-label="Chats"
        onClick={e => e.stopPropagation()}
      >
        <div className="drawer-head">
          <h2>Chats</h2>
          <button
            ref={closeBtnRef}
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Cerrar historial de chats"
          >
            <IconClose />
          </button>
        </div>

        <div className="drawer-body">
          <HistoryList
            items={items}
            activeId={activeId}
            connected={connected}
            onNewTask={() => {
              onClose();
              onNewTask();
            }}
            onSelect={id => {
              onClose();
              onSelect(id);
            }}
            busy={busy}
          />
          <button
            type="button"
            className="secondary full sidebar-settings-btn"
            onClick={() => {
              onClose();
              onOpenSettings();
            }}
            aria-label="Abrir ajustes desde el drawer de chats"
          >
            <IconSettings /> Ajustes
          </button>
        </div>
      </aside>
    </div>
  );
}
