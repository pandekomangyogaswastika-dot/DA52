import React, { useState } from 'react';
import ImportCenterPage from './marketing/ImportCenterPage';
import SmartImportEditorPage from './marketing/SmartImportEditorPage';

/**
 * Wrapper module for the Import Center.
 * Manages internal navigation between list view and editor view.
 */
export default function ImportCenterModule({ token, user }) {
  const [selectedSessionId, setSelectedSessionId] = useState(null);

  if (selectedSessionId) {
    return (
      <SmartImportEditorPage
        sessionId={selectedSessionId}
        user={user}
        token={token}
        onBack={() => setSelectedSessionId(null)}
      />
    );
  }

  return (
    <ImportCenterPage
      user={user}
      token={token}
      onOpenSession={setSelectedSessionId}
    />
  );
}
