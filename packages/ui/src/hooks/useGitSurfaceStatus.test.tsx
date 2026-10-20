import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { GitStatus } from '@/lib/api/types';

const statusWith = (files: string[]): GitStatus => ({
  current: 'main',
  tracking: null,
  ahead: 0,
  behind: 0,
  files: files.map((path) => ({ path, index: ' ', working_dir: 'M' })),
  isClean: files.length === 0,
  unborn: false,
});

/**
 * The rail badge counts the changes of the repository a git surface works on.
 * When the project root is not itself a repository — two independent
 * repositories under one opened folder, #5268 — the Git panel lists the nested
 * repository's files. The badge beside it must count those same files; counted
 * on the root it shows nothing, because a directory that is not a repository
 * has no status at all.
 */
test('the git surface status belongs to the nested repository when the root is not one (#5268)', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom, document: dom.document, navigator: dom.navigator, location: dom.location,
    localStorage: dom.localStorage,
    Element: dom.Element, HTMLElement: dom.HTMLElement, Node: dom.Node,
    Event: dom.Event, CustomEvent: dom.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [name, value] of Object.entries(globals)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const originalFetch = globalThis.fetch;
  // Every git answer below is seeded into the store: a request would mean the
  // hook probed or scanned something it already has an answer for.
  const requested: string[] = [];
  globalThis.fetch = Object.assign((input: RequestInfo | URL) => {
    requested.push(new URL(input instanceof Request ? input.url : String(input), 'http://localhost').pathname);
    return new Promise<Response>(() => {});
  }, originalFetch);

  const { createRoot } = await import('react-dom/client');
  const { RuntimeAPIContext } = await import('@/contexts/runtimeAPIContext');
  const { createWebAPIs } = await import('../../../web/src/api/index');
  const { useGitStore } = await import('@/stores/useGitStore');
  const { getRuntimeKey } = await import('@/lib/runtime-switch');
  const { useGitSurfaceStatus } = await import('./useGitSurfaceStatus');

  const root = '/workspace';
  const frontend = '/workspace/frontend';
  const seedDirectory = (directory: string, status: GitStatus | null) => {
    const directories = new Map(useGitStore.getState().directories);
    directories.set(directory, {
      isGitRepo: status !== null,
      status,
      branches: null,
      log: null,
      identity: null,
      diffCache: new Map(),
      indexRevision: 0,
      lastRepoCheckAt: Date.now(),
      lastStatusFetch: Date.now(),
      lastStatusChange: 0,
      lastLogFetch: 0,
      lastBranchesFetch: 0,
      lastIdentityFetch: 0,
      logMaxCount: 25,
      isLoadingStatus: false,
      isLoadingLog: false,
      isLoadingBranches: false,
      isLoadingIdentity: false,
    });
    useGitStore.setState({ directories });
  };

  const captured: { current: ReturnType<typeof useGitSurfaceStatus> | null } = { current: null };
  function Harness() {
    captured.current = useGitSurfaceStatus(root);
    return null;
  }
  const container = document.createElement('div');
  document.body.append(container);
  const reactRoot = createRoot(container);
  const apis = createWebAPIs();

  try {
    useGitStore.getState().resetForRuntimeSwitch(getRuntimeKey());
    // The root is not a repository; the nested one has three changed files and
    // the project already resolved to it (discovered, then auto-selected).
    await act(async () => {
      seedDirectory(root, null);
      seedDirectory(frontend, statusWith(['src/a.ts', 'src/b.ts', 'README.md']));
      useGitStore.setState({ nestedReposByRoot: new Map([[root, [frontend]]]) });
      useGitStore.getState().selectNestedRepo(root, frontend);
    });

    await act(async () => {
      reactRoot.render(<RuntimeAPIContext.Provider value={apis}><Harness /></RuntimeAPIContext.Provider>);
    });

    // Counted on the root this is null — the badge would be absent.
    expect(useGitStore.getState().directories.get(root)?.status ?? null).toBeNull();
    expect(captured.current?.files.length).toBe(3);

    expect(requested.filter((path) => path !== '/api/fs/home')).toEqual([]);
  } finally {
    await act(async () => { reactRoot.unmount(); });
    globalThis.fetch = originalFetch;
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
