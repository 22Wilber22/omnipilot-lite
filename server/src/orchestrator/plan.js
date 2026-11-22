export function createPlan(mode = 'demo') {
  if (mode === 'codex') {
    return [
      { id: 1, role: 'implement', agent: 'codex', title: 'Implementar solución' },
      { id: 2, role: 'review', agent: 'codex', title: 'Revisar en modo solo lectura' },
      { id: 3, role: 'verify', agent: 'local', title: 'Verificar con prueba fija' },
      { id: 4, role: 'fix', agent: 'codex', title: 'Corregir una sola vez si falla' },
    ];
  }
  return [
    { id: 1, role: 'code', agent: 'codex', title: 'Implementar solución' },
    { id: 2, role: 'review', agent: 'gemini', title: 'Revisar con contexto compartido' },
    { id: 3, role: 'verify', agent: 'local', title: 'Verificar resultados' },
  ];
}
