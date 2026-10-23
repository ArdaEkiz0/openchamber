import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { OpenCode } from '@opencode/client'
import { opencodeClient } from '@/lib/opencode/client'
import type { Session } from '@/lib/opencode/model'
import { adoptSessionMove } from '../session-actions'

/**
 * #5453, freeze half: an open chat pane resolves the directory it reads from
 * the session record (cross-store, same lookup ContextSurfacePanes makes).
 * When the session moves to another worktree, the record — transcript and
 * live deltas with it — lands in the destination store, so this lookup must
 * follow the move for the pane to keep receiving updates.
 */
import { SyncProvider, useDirectoryStore, useSessionDirectory } from '../sync-context'
import { installHookTestDom } from '../../components/session/sidebar/test-utils/testDom'

const FROM_DIR = '/subagent/old'
const TO_DIR = '/subagent/new'
const SESSION_ID = 'ses_1'

const createSdk = () => OpenCode.make({
  baseUrl: 'https://sync.test',
  fetch: async (request) => {
    const path = new URL(request instanceof Request ? request.url : request.toString()).pathname
    if (path.endsWith('/event')) {
      return new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } })
    }
    const body = path.endsWith('/location')
      ? { directory: FROM_DIR, project: { id: 'project', directory: FROM_DIR, canonical: FROM_DIR } }
      : path.endsWith('/session/active') ? {}
      : { data: [] }
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  },
})

const session = (directory: string): Session => ({
  id: SESSION_ID,
  projectID: 'proj_1',
  directory,
  title: 'Child',
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
})

// What the pane reads: the record's directory, searched across stores.
let resolvedDirectory: string | undefined
let sourceStore: ReturnType<typeof useDirectoryStore> | null = null
let destinationStore: ReturnType<typeof useDirectoryStore> | null = null

const Probe = () => {
  sourceStore = useDirectoryStore(FROM_DIR, { bootstrap: false })
  destinationStore = useDirectoryStore(TO_DIR, { bootstrap: false })
  resolvedDirectory = useSessionDirectory(SESSION_ID)
  return null
}

describe("a session record's directory follows its move across stores", () => {
  let dom: ReturnType<typeof installHookTestDom>
  let root: Root
  let restoreSpies: Array<() => void>
  let previousSurface: typeof window.__OPENCHAMBER_SURFACE__

  beforeEach(() => {
    dom = installHookTestDom()
    previousSurface = window.__OPENCHAMBER_SURFACE__
    window.__OPENCHAMBER_SURFACE__ = 'desktop'
    const spies = [
      spyOn(opencodeClient, 'getFilesystemHomeInfo').mockResolvedValue({ home: '/home' }),
      spyOn(opencodeClient, 'getFilesystemHome').mockResolvedValue('/home'),
      spyOn(opencodeClient, 'getLocation').mockResolvedValue({
        directory: FROM_DIR,
        project: { id: 'project', directory: FROM_DIR, canonical: FROM_DIR },
      }),
      spyOn(opencodeClient, 'getConfig').mockResolvedValue({}),
      spyOn(opencodeClient, 'listProjects').mockResolvedValue([]),
    ]
    restoreSpies = spies.map((spy) => () => spy.mockRestore())
    root = createRoot(dom.container)
    resolvedDirectory = undefined
    sourceStore = null
    destinationStore = null
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    restoreSpies.forEach((restore) => restore())
    window.__OPENCHAMBER_SURFACE__ = previousSurface
    dom.restore()
  })

  test('the cross-store record lookup lands on the move destination', async () => {
    await act(async () => root.render(
      <SyncProvider sdk={createSdk()} directory="">
        <Probe />
      </SyncProvider>,
    ))

    // Before the move: the record lives in the source store (the parent's
    // directory), which is where the pane opened its chat.
    await act(async () => sourceStore!.setState({ session: [session(FROM_DIR)], sessionTotal: 1 }))
    expect(resolvedDirectory).toBe(FROM_DIR)

    act(() => adoptSessionMove(SESSION_ID, FROM_DIR, TO_DIR))

    // After the move, the same lookup — no directory argument, exactly the
    // pane's wiring — resolves the destination, and the records have moved.
    expect(resolvedDirectory).toBe(TO_DIR)
    expect(sourceStore!.getState().session).toHaveLength(0)
    expect(destinationStore!.getState().session[0]).toMatchObject({ id: SESSION_ID, directory: TO_DIR })
  })
})
