import { describe, expect, mock, test } from 'bun:test';

// The module fetches through the runtime resolver; the test replaces it so the
// headers can be inspected without a server. Mocked before the import below.
const calls: Array<{ url: string; headers: Headers }> = [];
mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ ok: true, result: { content: 'demo' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
}));

const { guestFileOperation } = await import('./files');

describe('guest file operation directory header', () => {
  test('sends a plain path as it is', async () => {
    calls.length = 0;
    await guestFileOperation('ext-1', { op: 'read', path: 'notes.txt' }, '/home/me/project');

    expect(calls).toHaveLength(1);
    expect(calls[0].headers.get('x-opencode-directory')).toBe('/home/me/project');
    expect(calls[0].headers.get('x-opencode-directory-encoding')).toBeNull();
  });

  test('percent-encodes a path that is not Latin-1 and marks it (#5179)', async () => {
    calls.length = 0;
    const project = '/home/me/项目/プロジェクト';

    await guestFileOperation('ext-1', { op: 'read', path: 'notes.txt' }, project);

    // A raw value here would make fetch throw before the request leaves, which
    // the guest saw as HOST_REJECTED.
    expect(calls[0].headers.get('x-opencode-directory')).toBe(encodeURIComponent(project));
    expect(calls[0].headers.get('x-opencode-directory-encoding')).toBe('uri');
  });

  test('omits both headers when no directory is open', async () => {
    calls.length = 0;
    await guestFileOperation('ext-1', { op: 'read', path: 'notes.txt' }, null);

    expect(calls[0].headers.get('x-opencode-directory')).toBeNull();
    expect(calls[0].headers.get('x-opencode-directory-encoding')).toBeNull();
  });
});
