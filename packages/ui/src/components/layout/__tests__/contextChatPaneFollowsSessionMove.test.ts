/**
 * Regression guard for #5453: a subagent chat opened from the parent's panel
 * must follow the child session when it moves to another worktree.
 *
 * The pane used to resolve its directory from the tab record alone — the
 * directory the chat was opened in. After a `session.moved`, the record,
 * transcript and live deltas live in the destination store, so the pane read a
 * store nothing arrived in anymore and went dark mid-turn. The wiring fix
 * resolves the directory from the session record first, and that lookup must
 * be cross-store (no explicit directory), or it could not see the destination.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contextPanelSource = readFileSync(join(__dirname, '..', 'ContextSurfacePanes.tsx'), 'utf-8');

describe('context panel chat pane follows a moved session', () => {
  test('resolves the active chat session directory from the session record', () => {
    expect(contextPanelSource).toContain('useSessionDirectory(activeChatSessionID)');
  });

  test('prefers the session record directory over the tab\'s recorded directory', () => {
    const memoStart = contextPanelSource.indexOf('const activeChatDirectory = React.useMemo(');
    expect(memoStart).toBeGreaterThan(-1);
    const memoEnd = contextPanelSource.indexOf('const activeChatPinnedSession', memoStart);
    expect(memoEnd).toBeGreaterThan(memoStart);
    const memo = contextPanelSource.slice(memoStart, memoEnd);

    expect(memo).toContain('recordDirectory || own || directoryKey || null');
    // The record directory is read through the cross-store lookup, so a move
    // to a directory this panel never opened still resolves.
    expect(memo).toContain('normalizeContextPanelDirectoryKey(activeChatSessionRecordDirectory)');
  });

  test('the pinned chat session carries the resolved directory', () => {
    expect(contextPanelSource).toContain(
      '() => (activeChatSessionID ? { sessionId: activeChatSessionID, directory: activeChatDirectory } : null),',
    );
  });
});
