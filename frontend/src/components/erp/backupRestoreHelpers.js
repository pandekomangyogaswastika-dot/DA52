// Advanced Backup/Restore Functions
// Import this in BackupRestoreModule.jsx

export const downloadBackup = async (backupId, token) => {
  try {
    const response = await fetch(`/api/admin/backup/download/${backupId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error('Download failed');
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${backupId}.zip`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

export const uploadBackup = async (file, token) => {
  try {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetch('/api/admin/backup/upload-file', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });
    
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || 'Upload failed');
    }
    
    return await response.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

export const listCollections = async (backupId, token) => {
  try {
    const response = await fetch(`/api/admin/backup/${backupId}/collections`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) throw new Error('Failed to list collections');
    
    return await response.json();
  } catch (e) {
    return { collections: [], error: e.message };
  }
};

export const restoreSelective = async (backupId, collections, mode, token) => {
  try {
    const response = await fetch('/api/admin/backup/restore-selective', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        backup_id: backupId,
        collections,
        mode,
        confirm: true
      })
    });
    
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || 'Restore failed');
    }
    
    return await response.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
