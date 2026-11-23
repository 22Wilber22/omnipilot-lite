import { describe, it, expect } from 'vitest';
import { API, fetchRunArtifact } from '../../web/src/apiClient.js';

describe('Hotfix — Descarga de artifacts contra la API local real', () => {
  it('usa API base URL (127.0.0.1:4317), envía X-Omni-Token en header (nunca en URL) y descarga evidencia JSON', async () => {
    const calls = [];
    const mockFetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ runId: 'abc', ok: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="omnipilot-evidence-abc.json"',
        },
      });
    };

    const { blob, filename } = await fetchRunArtifact('secret-token-123', '/api/runs/abc/evidence', {
      expectedContentType: 'application/json',
      fallbackFilename: 'fallback.json',
      fetchImpl: mockFetch,
    });

    expect(calls[0].url).toBe(`${API}/api/runs/abc/evidence`);
    expect(calls[0].url).not.toContain('secret-token-123');
    expect(calls[0].init.headers['X-Omni-Token']).toBe('secret-token-123');
    expect(filename).toBe('omnipilot-evidence-abc.json');
    expect(await blob.text()).toContain('"runId":"abc"');
  });

  it('descarga parche text/x-diff y rechaza respuestas text/html inesperadas sin crear descarga', async () => {
    const patchFetch = async () => new Response('diff --git a/README.md b/README.md\n+hola\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/x-diff; charset=utf-8',
        'Content-Disposition': 'attachment; filename="omnipilot-changes-abc.diff"',
      },
    });
    const { blob, filename } = await fetchRunArtifact('tok', '/api/runs/abc/patch', {
      expectedContentType: 'text/x-diff',
      fallbackFilename: 'fallback.diff',
      fetchImpl: patchFetch,
    });
    expect(filename).toBe('omnipilot-changes-abc.diff');
    expect(await blob.text()).toContain('diff --git');

    const htmlFetch = async () => new Response('<!doctype html><html></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
    await expect(fetchRunArtifact('tok', '/api/runs/abc/evidence', {
      expectedContentType: 'application/json',
      fallbackFilename: 'fallback.json',
      fetchImpl: htmlFetch,
    })).rejects.toThrow('La descarga recibió una respuesta inesperada de la interfaz local.');
  });
});
