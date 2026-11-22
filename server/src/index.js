import { randomBytes } from 'node:crypto';
import { createApp } from './api/app.js';

const token = randomBytes(32).toString('hex');
const port = Number(process.env.PORT ?? 4317);
const app = createApp({ token, port });

app.listen(port, '127.0.0.1', () => {
  console.log(`OmniPilot API http://127.0.0.1:${port}`);
  console.log(`TOKEN LOCAL (no compartir): ${token}`);
  console.log('Modos disponibles: demo (simulado) y codex (ejecución local con Codex CLI).');
});
