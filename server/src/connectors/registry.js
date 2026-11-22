import { codexConnector } from './codexConnector.js';
import { antigravityConnector } from './antigravityConnector.js';

export const connectorRegistry = Object.freeze({
  codex: codexConnector,
  antigravity: antigravityConnector,
});

export function getConnector(name) {
  return connectorRegistry[name] ?? null;
}

export function listConnectors() {
  return Object.keys(connectorRegistry);
}
