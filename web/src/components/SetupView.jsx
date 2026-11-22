import { useState } from 'react';

export default function SetupView({ token, setToken, mode, setMode, onConnect, busy, error }) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <section className="card centered">
      <h2 className="title-lg">Configura OmniPilot</h2>
      <p className="subtitle">Conecta asistentes locales para planificar, implementar y verificar tareas.</p>

      <div className="field">
        <label htmlFor="local-token">Token de conexión local</label>
        <input
          id="local-token"
          type="password"
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder="Pega el token mostrado al iniciar el servidor"
          autoComplete="off"
        />
        <p className="muted">Solo permanece en memoria de esta pestaña. Nunca se guarda en localStorage.</p>
      </div>

      <button type="button" className="primary full" onClick={onConnect} disabled={!token.trim() || busy}>
        {busy ? 'Verificando conexión...' : 'Conectar y continuar'}
      </button>

      <div className="advanced-wrap">
        <button type="button" className="link-btn" onClick={() => setShowAdvanced(v => !v)}>
          {showAdvanced ? 'Ocultar opciones avanzadas' : 'Opciones avanzadas'}
        </button>
        {showAdvanced && (
          <div className="advanced-box">
            <p className="muted">Servidor local: <code>http://127.0.0.1:4317</code></p>
            <label htmlFor="setup-mode" style={{ marginTop: 10 }}>Modo de ejecución</label>
            <select id="setup-mode" value={mode} onChange={e => setMode(e.target.value)}>
              <option value="codex">Ejecución local real (Codex CLI)</option>
              <option value="demo">Modo demostración (simulado)</option>
            </select>
          </div>
        )}
      </div>

      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
