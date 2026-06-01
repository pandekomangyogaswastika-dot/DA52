/**
 * CommunicationTab.jsx
 * Phase 3.1: Full Communication Hub integrated into Portal Kolaborasi tab.
 * Wraps the existing CommunicationHubPortal with embedded mode
 * so it fits inside the collaboration layout (h-full instead of h-[calc(100vh-130px)]).
 */

import CommunicationHubPortal from '../../CommunicationHubPortal';

export default function CommunicationTab({ user, token }) {
  return (
    <div className="h-full flex flex-col" data-testid="communication-tab">
      <CommunicationHubPortal
        user={user}
        token={token}
        isEmbedded={true}
      />
    </div>
  );
}
