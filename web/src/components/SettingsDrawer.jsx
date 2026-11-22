import { useEffect } from 'react';
import { IconClose } from './Icons.jsx';
import RoleSelect from './RoleSelect.jsx';
import SkillCard from './SkillCard.jsx';
import { StatusBadge } from './UiPrimitives.jsx';

const NEXT_STATUS = {
  suggested: 'installed',
  installed: 'active',
  active: 'suggested',
};

const USAGE_OPTIONS = ['Mínimo', 'Bajo', 'Medio', 'Alto', 'Máximo'];

export default function SettingsDrawer({
  open, onClose,
  token, setToken, mode, setMode,
  diagnostics, onCheckConnection,
  roles, setRoles,
  skills, setSkills,
  usageLevels, setUsageLevels,
  busy, error,
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const codexOk = Boolean(diagnostics?.codex?.available);
  const agyOk = Boolean(diagnostics?.antigravity?.available);

  const cycleSkill = (id) => {
    setSkills(prev => prev.map(s => (s.id === id ? { ...s, status: NEXT_STATUS[s.status] } : s)));
  };

  return (
    <div className="drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Ajustes del orquestador"
        onClick={e => e.stopPropagation()}
      >
        <div className="drawer-head">
          <div>
            <h2>Ajustes</h2>
            <p className="muted">Conexión local, proveedores, roles, skills y uso de IA.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar ajustes">
            <IconClose />
          </button>
        </div>

        <div className="drawer-body">
          <section className="settings-block">
            <h3>A. Conexión local</h3>
            <label htmlFor="settings-token">Token de sesión local (solo en memoria de esta pestaña)</label>
            <div className="row-gap">
              <input
                id="settings-token"
                type="password"
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="Pega el token impreso en la terminal"
                autoComplete="off"
              />
              <button type="button" className="primary sm" onClick={onCheckConnection} disabled={!token.trim() || busy}>
                {busy ? 'Verificando...' : 'Verificar'}
              </button>
            </div>
            {error && <p className="error" role="alert">{error}</p>}
          </section>

          <section className="settings-block">
            <h3>B. Proveedores</h3>
            <div className="kv-list">
              <div className="kv-row">
                <div><strong>Codex</strong><span className="muted"> · Implementación y corrección</span></div>
                <StatusBadge variant={diagnostics ? (codexOk ? 'ok' : 'fail') : 'wait'}>
                  {diagnostics ? (codexOk ? 'Disponible' : 'Sin conexión') : 'Sin verificar'}
                </StatusBadge>
              </div>
              <div className="kv-row">
                <div><strong>Antigravity</strong><span className="muted"> · Planificación y revisión</span></div>
                <StatusBadge variant={diagnostics ? (agyOk ? 'ok' : 'wait') : 'wait'}>
                  {diagnostics ? (agyOk ? 'Disponible' : 'Fallback a Codex') : 'Sin verificar'}
                </StatusBadge>
              </div>
              <div className="kv-row muted-row">
                <div><strong>IA local</strong><span className="muted"> · Modelos locales</span></div>
                <StatusBadge variant="wait">Próximamente</StatusBadge>
              </div>
            </div>
          </section>

          <section className="settings-block">
            <h3>C. Roles del orquestador</h3>
            <div className="kv-list">
              <RoleSelect
                id="role-plan"
                label="Planificación"
                value={roles.plan}
                onChange={v => setRoles(r => ({ ...r, plan: v }))}
                options={[
                  { value: 'antigravity', label: 'Antigravity', disabled: diagnostics && !agyOk },
                  { value: 'codex', label: 'Codex' },
                ]}
                note={diagnostics && !agyOk ? 'Antigravity no disponible: usa Codex.' : ''}
              />
              <RoleSelect
                id="role-implement"
                label="Implementación"
                value={roles.implement}
                onChange={v => setRoles(r => ({ ...r, implement: v }))}
                options={[{ value: 'codex', label: 'Codex' }]}
                note="Antigravity solo opera en modo lectura (--mode plan)."
              />
              <RoleSelect
                id="role-review"
                label="Revisión"
                value={roles.review}
                onChange={v => setRoles(r => ({ ...r, review: v }))}
                options={[
                  { value: 'antigravity', label: 'Antigravity', disabled: diagnostics && !agyOk },
                  { value: 'codex-readonly', label: 'Codex (solo lectura)' },
                ]}
              />
              <RoleSelect
                id="role-fix"
                label="Corrección"
                value={roles.fix}
                onChange={v => setRoles(r => ({ ...r, fix: v }))}
                options={[{ value: 'codex', label: 'Codex' }]}
              />
              <RoleSelect
                id="role-verify"
                label="Verificación"
                lockedText="Pruebas locales fijas — no editable"
              />
            </div>
            <p className="muted" style={{ marginTop: 10 }}>
              La aplicación de estos roles a futuras ejecuciones se conectará al backend en el siguiente sprint.
            </p>
          </section>

          <section className="settings-block">
            <h3>D. Skills sugeridas</h3>
            <p className="muted">Pulsa una skill para cambiar entre Sugerida, Instalada y Activa.</p>
            <div className="skills-stack">
              {skills.map(skill => (
                <SkillCard key={skill.id} skill={skill} onToggle={cycleSkill} />
              ))}
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              Una skill activa añade reglas breves al contexto del agente; no descarga archivos todavía.
            </p>
          </section>

          <section className="settings-block">
            <h3>E. Uso de IA</h3>
            <div className="kv-list">
              <div className="kv-row">
                <label htmlFor="usage-codex">Codex</label>
                <select id="usage-codex" value={usageLevels.codex} onChange={e => setUsageLevels(u => ({ ...u, codex: e.target.value }))}>
                  {USAGE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
              <div className="kv-row">
                <label htmlFor="usage-agy">Antigravity</label>
                <select id="usage-agy" value={usageLevels.antigravity} onChange={e => setUsageLevels(u => ({ ...u, antigravity: e.target.value }))}>
                  {USAGE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              Controla contexto, salida y esfuerzo cuando el proveedor lo admite. Los límites de seguridad del backend no cambian.
            </p>
          </section>

          <details className="fold-block">
            <summary>F. Configuración avanzada</summary>
            <div className="kv-list" style={{ marginTop: 12 }}>
              <div className="kv-row">
                <label htmlFor="adv-mode">Modo de ejecución</label>
                <select id="adv-mode" value={mode} onChange={e => setMode(e.target.value)}>
                  <option value="codex">Ejecución local real (Codex)</option>
                  <option value="demo">Modo demostración (simulado)</option>
                </select>
              </div>
              <p className="muted">
                Timeout, aprobación humana, verificación fija y límites de sandbox permanecen siempre activos y no son desactivables.
              </p>
            </div>
          </details>
        </div>
      </aside>
    </div>
  );
}
