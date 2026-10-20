import React from 'react';

import { useNestedGitDirectory } from '@/hooks/useNestedGitDirectory';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { useGitStatus, useGitStore } from '@/stores/useGitStore';

/**
 * The status a git surface shows for a project root.
 *
 * The Git and Changes panels resolve the repository they work on through
 * `useNestedGitDirectory`: when the root is not itself a repository, that is
 * the nested repository the user picked (or the first one discovered). The
 * rail badge counts the changes of that same repository — counted on the root
 * it has nothing to show for a project root that is not a repository, while
 * the panel beside it lists the nested repository's files (#5268).
 *
 * Resolution is shared, not duplicated: probing the root, discovering nested
 * repositories, auto-selecting the first one, and dropping a stale selection
 * all happen in the hook, so the badge and the panel cannot disagree. The
 * status is requested here too; a reader that only selects it would keep the
 * badge empty until some other surface happened to load the same directory.
 */
export const useGitSurfaceStatus = (root: string | null) => {
  const { git } = useRuntimeAPIs();
  const { gitDirectory } = useNestedGitDirectory(root, { enabled: Boolean(root) });
  const ensureStatus = useGitStore((state) => state.ensureStatus);
  const status = useGitStatus(gitDirectory);

  React.useEffect(() => {
    if (!gitDirectory) return;
    void ensureStatus(gitDirectory, git);
  }, [ensureStatus, git, gitDirectory]);

  return status;
};
