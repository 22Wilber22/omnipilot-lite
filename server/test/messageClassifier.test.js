import { describe, expect, it } from 'vitest';
import { classifyMessage } from '../src/orchestrator/messageClassifier.js';

describe('clasificación de mensajes', () => {
  it.each(['dale', 'sí', 'si', 'ok', 'okay', 'claro', 'perfecto', 'gracias', 'entendido', 'continúa', 'continuar'])(
    'trata “%s” como conversación',
    message => expect(classifyMessage(message)).toBe('conversation'),
  );

  it.each(['Implementa el módulo', 'Corrige el código', 'Revisa el proyecto', 'Analiza las pruebas'])(
    'trata “%s” como tarea concreta',
    message => expect(classifyMessage(message)).toBe('task'),
  );
});
