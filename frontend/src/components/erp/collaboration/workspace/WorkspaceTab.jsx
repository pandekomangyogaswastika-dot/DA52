/**
 * WorkspaceTab.jsx
 * Wrapper for existing WorkspacePortal to integrate as a tab in CollaborationPortal
 * Reuses all Phase 0-5 features without modification
 */

import WorkspacePortal from '../../WorkspacePortal';

export default function WorkspaceTab({ user, token, portalContext }) {
  // Simply render the existing WorkspacePortal
  // It's a full-featured component with its own navigation and state
  return (
    <div className="h-full w-full">
      <WorkspacePortal 
        user={user}
        token={token}
        // Pass context to indicate it's being used within Collaboration Portal
        isTabContext={portalContext === 'collaboration'}
      />
    </div>
  );
}
