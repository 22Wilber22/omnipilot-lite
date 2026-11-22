import { useEffect, useState } from 'react';
const API = 'http://127.0.0.1:4317';
export default function App() {
 const [token,setToken]=useState(''); const [goal,setGoal]=useState('Implementar validatePassword y verificarla con pruebas');
 const [run,setRun]=useState(null); const [events,setEvents]=useState([]); const [error,setError]=useState('');
 const request=async(path,method='GET',body)=>{ const r=await fetch(API+path,{method,headers:{'X-Omni-Token':token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw Error(j.error||'Error');return j; };
 async function create(){try{setError('');setEvents([]);setRun(await request('/api/runs','POST',{goal,mode:'demo'}));}catch(e){setError(e.message)}}
 async function action(name){try{await request(`/api/runs/${run.id}/${name}`,'POST');refresh();}catch(e){setError(e.message)}}
 async function refresh(){if(!run)return;try{const r=await request(`/api/runs/${run.id}`);setRun(r);setEvents(r.events);}catch(e){setError(e.message)}}
 useEffect(()=>{if(!run||!['pending','running'].includes(run.status))return;const timer=setInterval(refresh,750);return()=>clearInterval(timer)},[run?.id,run?.status,token]);
 return <main><header><div><div className="eyebrow">DOJO · LOCAL-FIRST · JAVASCRIPT</div><h1>OmniPilot <span>Lite</span></h1><p>Un objetivo. Varios agentes. Una memoria compartida.</p></div><div className="mode">MODO DEMOSTRACIÓN<br/><small>Agentes simulados, pruebas reales</small></div></header>
 <div className="layout"><section><h2>1. Conexión local</h2><label>Token mostrado en la terminal del servidor</label><input type="password" value={token} onChange={e=>setToken(e.target.value)} placeholder="Pega el token local" autoComplete="off"/><p className="muted">El token solo permanece en esta pestaña. No se almacena en el navegador.</p></section>
 <section><h2>2. Objetivo</h2><textarea rows="3" maxLength="1200" value={goal} onChange={e=>setGoal(e.target.value)}/><button onClick={create} disabled={!token||!goal.trim()}>Crear plan</button></section></div>
 {run&&<section><div className="between"><h2>3. Plan y ejecución</h2><span className="pill">{run.status}</span></div><p className="muted">Ejecución {run.id.slice(0,8)} · {run.mode}</p><div className="steps">{run.plan.map(s=><article key={s.id}><b>{s.id}. {s.title}</b><small>{s.agent} · {s.role}</small></article>)}</div><div className="actions">{run.status==='pending'&&<button onClick={()=>action('approve')}>Aprobar y ejecutar</button>}{run.status==='running'&&<button className="danger" onClick={()=>action('cancel')}>Cancelar</button>}<button className="secondary" onClick={refresh}>Actualizar</button></div></section>}
 {run&&<section><h2>4. Registro de eventos</h2><div className="logs">{events.length?events.map(e=><div key={e.seq}><time>{e.at.slice(11,19)}</time> <b>[{e.type}]</b> {e.message}</div>):<span>Esperando aprobación...</span>}</div>{run.status==='completed'&&<p className="success">✓ Verificación finalizada. Revisa el archivo proyecto.json en workspaces/.</p>}</section>}
 {error&&<p className="error" role="alert">{error}</p>}<footer>Los conectores reales permanecen deshabilitados hasta verificar la autenticación, flags y sandbox de las CLI. Esta interfaz NO afirma ejecutar Codex ni Gemini.</footer></main>
}
