"""
Admin Backup & Restore Management
Provides API endpoints for database backup/restore operations
Access: Superadmin only
"""
import os
import json
import subprocess
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from pydantic import BaseModel
from database import get_db
from auth import require_auth

router = APIRouter(prefix="/admin/backup", tags=["admin", "backup"])

BACKUP_DIR = Path("/app/backups")
BACKUP_SCRIPT = "/app/scripts/backup.sh"
RESTORE_SCRIPT = "/app/scripts/restore.sh"
CLEANUP_SCRIPT = "/app/scripts/cleanup_old_backups.sh"
RETENTION_DAYS = 30


class BackupMetadata(BaseModel):
    backup_id: str
    backup_name: str
    created_at: str
    size: str
    status: str
    database: Optional[str] = None


class BackupCreateRequest(BaseModel):
    backup_name: Optional[str] = None
    notify: bool = True


class RestoreRequest(BaseModel):
    backup_id: str
    confirm: bool = False


class UploadRestoreRequest(BaseModel):
    collections: Optional[List[str]] = None  # None = all collections
    mode: str = "overwrite"  # "merge" or "overwrite"
    confirm: bool = False


class SelectiveRestoreRequest(BaseModel):
    backup_id: str
    collections: List[str]  # Selected collections to restore
    mode: str = "overwrite"  # "merge" or "overwrite"
    confirm: bool = False


def _require_superadmin(user: dict) -> dict:
    """Check if user is superadmin"""
    if user.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Superadmin access required")
    return user


def _get_backup_metadata(backup_path: Path) -> Optional[dict]:
    """Read metadata.json from backup directory"""
    metadata_file = backup_path / "metadata.json"
    if metadata_file.exists():
        try:
            with open(metadata_file, 'r') as f:
                return json.load(f)
        except Exception:
            pass
    return None


def _calculate_dir_size(path: Path) -> str:
    """Calculate directory size in human-readable format"""
    try:
        result = subprocess.run(
            ['du', '-sh', str(path)],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            return result.stdout.split()[0]
    except Exception:
        pass
    return "unknown"


async def _send_notification(user_id: str, title: str, message: str, type: str = "info"):
    """Send in-app notification"""
    try:
        from routes.rahaza_notifications import send_notification
        await send_notification(
            user_id=user_id,
            title=title,
            message=message,
            type=type,
            category="system"
        )
    except Exception as e:
        print(f"Failed to send notification: {e}")


@router.get("/list")
async def list_backups(request: Request):
    """List all available backups"""
    user = await require_auth(request)
    _require_superadmin(user)
    
    if not BACKUP_DIR.exists():
        return {"backups": []}
    
    backups = []
    for backup_path in BACKUP_DIR.iterdir():
        if backup_path.is_dir():
            metadata = _get_backup_metadata(backup_path)
            
            if metadata:
                backup_info = {
                    "backup_id": backup_path.name,
                    "backup_name": metadata.get("backup_name", backup_path.name),
                    "created_at": metadata.get("created_at"),
                    "size": metadata.get("size", "unknown"),
                    "status": metadata.get("status", "unknown"),
                    "database": metadata.get("database")
                }
            else:
                # Fallback if no metadata
                stat = backup_path.stat()
                backup_info = {
                    "backup_id": backup_path.name,
                    "backup_name": backup_path.name,
                    "created_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                    "size": _calculate_dir_size(backup_path),
                    "status": "success",
                    "database": None
                }
            
            backups.append(backup_info)
    
    # Sort by created_at descending (newest first)
    backups.sort(key=lambda x: x["created_at"], reverse=True)
    
    return {"backups": backups, "total": len(backups)}


@router.post("/create")
async def create_backup(
    request: Request,
    body: BackupCreateRequest,
    background_tasks: BackgroundTasks
):
    """Create a new database backup"""
    user = await require_auth(request)
    _require_superadmin(user)
    
    # Generate backup name
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_name = body.backup_name or f"manual_{timestamp}"
    
    # Run backup script in background
    async def run_backup():
        try:
            process = await asyncio.create_subprocess_exec(
                BACKUP_SCRIPT,
                backup_name,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            
            if process.returncode == 0:
                if body.notify:
                    await _send_notification(
                        user["id"],
                        "✅ Backup Berhasil",
                        f"Database backup '{backup_name}' telah dibuat dengan sukses",
                        "success"
                    )
            else:
                if body.notify:
                    await _send_notification(
                        user["id"],
                        "❌ Backup Gagal",
                        f"Database backup '{backup_name}' gagal: {stderr.decode()}",
                        "error"
                    )
        except Exception as e:
            if body.notify:
                await _send_notification(
                    user["id"],
                    "❌ Backup Error",
                    f"Error saat backup: {str(e)}",
                    "error"
                )
    
    background_tasks.add_task(run_backup)
    
    return {
        "ok": True,
        "message": f"Backup '{backup_name}' sedang diproses di background",
        "backup_name": backup_name
    }


@router.post("/restore")
async def restore_backup(request: Request, body: RestoreRequest):
    """Restore database from backup"""
    user = await require_auth(request)
    _require_superadmin(user)
    
    if not body.confirm:
        raise HTTPException(
            status_code=400,
            detail="Confirmation required. Set 'confirm: true' to proceed with restore."
        )
    
    backup_path = BACKUP_DIR / body.backup_id
    if not backup_path.exists():
        raise HTTPException(status_code=404, detail=f"Backup '{body.backup_id}' not found")
    
    # Run restore script (blocking operation - this will restart services)
    try:
        result = subprocess.run(
            [RESTORE_SCRIPT, body.backup_id],
            input=b"yes\n",  # Auto-confirm
            capture_output=True,
            timeout=300  # 5 minutes timeout
        )
        
        if result.returncode == 0:
            await _send_notification(
                user["id"],
                "✅ Restore Berhasil",
                f"Database berhasil di-restore dari backup '{body.backup_id}'",
                "success"
            )
            return {
                "ok": True,
                "message": f"Database berhasil di-restore dari '{body.backup_id}'",
                "output": result.stdout.decode()
            }
        else:
            error_msg = result.stderr.decode()
            await _send_notification(
                user["id"],
                "❌ Restore Gagal",
                f"Restore dari '{body.backup_id}' gagal: {error_msg}",
                "error"
            )
            raise HTTPException(
                status_code=500,
                detail=f"Restore failed: {error_msg}"
            )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Restore timeout (>5 minutes)")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Restore error: {str(e)}")


@router.delete("/{backup_id}")
async def delete_backup(request: Request, backup_id: str):
    """Delete a backup"""
    user = await require_auth(request)
    _require_superadmin(user)
    
    backup_path = BACKUP_DIR / backup_id
    if not backup_path.exists():
        raise HTTPException(status_code=404, detail=f"Backup '{backup_id}' not found")
    
    try:
        import shutil
        shutil.rmtree(backup_path)
        
        await _send_notification(
            user["id"],
            "🗑️ Backup Dihapus",
            f"Backup '{backup_id}' telah dihapus",
            "info"
        )
        
        return {"ok": True, "message": f"Backup '{backup_id}' deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")


@router.post("/cleanup")
async def cleanup_old_backups(request: Request):
    """Cleanup backups older than retention period"""
    user = await require_auth(request)
    _require_superadmin(user)
    
    try:
        result = subprocess.run(
            [CLEANUP_SCRIPT, str(RETENTION_DAYS)],
            capture_output=True,
            text=True,
            timeout=60
        )
        
        return {
            "ok": True,
            "message": f"Cleanup completed (retention: {RETENTION_DAYS} days)",
            "output": result.stdout
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cleanup failed: {str(e)}")


@router.get("/config")
async def get_backup_config(request: Request):
    """Get backup configuration"""
    user = await require_auth(request)
    _require_superadmin(user)
    
    return {
        "backup_dir": str(BACKUP_DIR),
        "retention_days": RETENTION_DAYS,
        "auto_backup_enabled": True,
        "auto_backup_schedule": "Daily at 02:00 Asia/Jakarta",
        "storage_type": "local_filesystem"
    }


@router.get("/download/{backup_id}")
async def download_backup(request: Request, backup_id: str):
    """Download backup as ZIP file"""
    from fastapi.responses import FileResponse
    import zipfile
    import tempfile
    
    user = await require_auth(request)
    _require_superadmin(user)
    
    backup_path = BACKUP_DIR / backup_id
    if not backup_path.exists():
        raise HTTPException(status_code=404, detail=f"Backup '{backup_id}' not found")
    
    try:
        # Create temporary ZIP file
        temp_zip = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
        temp_zip.close()
        
        # Create ZIP archive
        with zipfile.ZipFile(temp_zip.name, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for file_path in backup_path.rglob('*'):
                if file_path.is_file():
                    arcname = file_path.relative_to(backup_path)
                    zipf.write(file_path, arcname)
        
        # Return as downloadable file
        return FileResponse(
            path=temp_zip.name,
            filename=f"{backup_id}.zip",
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename={backup_id}.zip"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")


@router.post("/upload")
async def upload_backup(request: Request):
    """Upload ZIP backup file from PC"""
    from fastapi import UploadFile, File, Form
    import zipfile
    import shutil
    
    user = await require_auth(request)
    _require_superadmin(user)
    
    # This endpoint will be called with multipart form data
    # We'll handle it in a separate endpoint with proper File upload
    return {"message": "Use POST /api/admin/backup/upload-file with multipart/form-data"}


@router.post("/upload-file")
async def upload_backup_file(
    request: Request,
    file: 'UploadFile'
):
    """Upload and extract ZIP backup file"""
    from fastapi import UploadFile
    import zipfile
    import tempfile
    import shutil
    
    user = await require_auth(request)
    _require_superadmin(user)
    
    # Get uploaded file from request
    form = await request.form()
    file = form.get('file')
    
    if not file:
        raise HTTPException(status_code=400, detail="No file uploaded")
    
    # Generate backup name from filename
    original_filename = file.filename.replace('.zip', '')
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_name = f"upload_{timestamp}_{original_filename}"
    backup_path = BACKUP_DIR / backup_name
    
    try:
        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as temp_file:
            content = await file.read()
            temp_file.write(content)
            temp_file_path = temp_file.name
        
        # Extract ZIP to backup directory
        backup_path.mkdir(parents=True, exist_ok=True)
        
        with zipfile.ZipFile(temp_file_path, 'r') as zipf:
            zipf.extractall(backup_path)
        
        # Clean up temp file
        Path(temp_file_path).unlink()
        
        # Create metadata
        metadata = {
            "backup_name": backup_name,
            "timestamp": timestamp,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "size": _calculate_dir_size(backup_path),
            "status": "uploaded",
            "uploaded_by": user["name"],
            "original_filename": file.filename
        }
        
        with open(backup_path / "metadata.json", 'w') as f:
            json.dump(metadata, f, indent=2)
        
        await _send_notification(
            user["id"],
            "✅ Backup Uploaded",
            f"Backup '{backup_name}' berhasil di-upload dari {file.filename}",
            "success"
        )
        
        return {
            "ok": True,
            "message": f"Backup uploaded successfully",
            "backup_id": backup_name,
            "backup_name": backup_name
        }
        
    except Exception as e:
        # Cleanup on error
        if backup_path.exists():
            shutil.rmtree(backup_path)
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@router.get("/{backup_id}/collections")
async def list_collections_in_backup(request: Request, backup_id: str):
    """List all collections available in a backup"""
    user = await require_auth(request)
    _require_superadmin(user)
    
    backup_path = BACKUP_DIR / backup_id
    if not backup_path.exists():
        raise HTTPException(status_code=404, detail=f"Backup '{backup_id}' not found")
    
    try:
        collections = []
        
        # Find database directory (usually named after database)
        db_dirs = [d for d in backup_path.iterdir() if d.is_dir() and d.name != '__pycache__']
        
        if not db_dirs:
            return {"collections": [], "database": None}
        
        db_dir = db_dirs[0]  # Take first database directory
        db_name = db_dir.name
        
        # List all .bson.gz files (collections)
        for bson_file in db_dir.glob('*.bson.gz'):
            collection_name = bson_file.stem.replace('.bson', '')
            
            # Get document count from metadata if available
            metadata_file = bson_file.with_suffix('').with_suffix('.metadata.json')
            doc_count = 0
            if metadata_file.exists():
                try:
                    with open(metadata_file, 'r') as f:
                        meta = json.load(f)
                        doc_count = meta.get('count', 0)
                except:
                    pass
            
            # Get file size
            size_bytes = bson_file.stat().st_size
            size_mb = round(size_bytes / (1024 * 1024), 2)
            
            collections.append({
                "name": collection_name,
                "size_mb": size_mb,
                "document_count": doc_count,
                "filename": bson_file.name
            })
        
        # Sort by name
        collections.sort(key=lambda x: x['name'])
        
        return {
            "collections": collections,
            "database": db_name,
            "total_collections": len(collections)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list collections: {str(e)}")


@router.post("/restore-selective")
async def restore_selective(request: Request, body: SelectiveRestoreRequest):
    """Restore selected collections only with merge/overwrite mode"""
    user = await require_auth(request)
    _require_superadmin(user)
    
    if not body.confirm:
        raise HTTPException(
            status_code=400,
            detail="Confirmation required. Set 'confirm: true' to proceed."
        )
    
    if not body.collections or len(body.collections) == 0:
        raise HTTPException(status_code=400, detail="No collections selected")
    
    if body.mode not in ['merge', 'overwrite']:
        raise HTTPException(status_code=400, detail="Mode must be 'merge' or 'overwrite'")
    
    backup_path = BACKUP_DIR / body.backup_id
    if not backup_path.exists():
        raise HTTPException(status_code=404, detail=f"Backup '{body.backup_id}' not found")
    
    try:
        # Find database directory
        db_dirs = [d for d in backup_path.iterdir() if d.is_dir() and d.name != '__pycache__']
        if not db_dirs:
            raise HTTPException(status_code=400, detail="No database found in backup")
        
        db_dir = db_dirs[0]
        
        # Build mongorestore command
        mongo_uri = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
        
        restored_collections = []
        failed_collections = []
        
        for collection_name in body.collections:
            collection_file = db_dir / f"{collection_name}.bson.gz"
            
            if not collection_file.exists():
                failed_collections.append({
                    "name": collection_name,
                    "error": "Collection file not found in backup"
                })
                continue
            
            try:
                # mongorestore options
                cmd = [
                    'mongorestore',
                    f'--uri={mongo_uri}',
                    '--gzip',
                    f'--nsInclude={db_dir.name}.{collection_name}'
                ]
                
                # Add mode-specific options
                if body.mode == 'overwrite':
                    cmd.append('--drop')  # Drop collection before restore
                # merge mode = no --drop (just insert/upsert documents)
                
                cmd.append(str(backup_path))
                
                # Execute restore
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=300
                )
                
                if result.returncode == 0:
                    restored_collections.append(collection_name)
                else:
                    failed_collections.append({
                        "name": collection_name,
                        "error": result.stderr
                    })
                    
            except Exception as e:
                failed_collections.append({
                    "name": collection_name,
                    "error": str(e)
                })
        
        # Send notification
        mode_text = "overwrite (drop & restore)" if body.mode == 'overwrite' else "merge (insert only)"
        await _send_notification(
            user["id"],
            "✅ Selective Restore Selesai" if not failed_collections else "⚠️ Selective Restore Sebagian Berhasil",
            f"Restored {len(restored_collections)}/{len(body.collections)} collections (mode: {mode_text})",
            "success" if not failed_collections else "warning"
        )
        
        return {
            "ok": True,
            "mode": body.mode,
            "restored_collections": restored_collections,
            "failed_collections": failed_collections,
            "total_requested": len(body.collections),
            "total_restored": len(restored_collections),
            "total_failed": len(failed_collections)
        }
        
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Restore timeout (>5 minutes)")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Selective restore error: {str(e)}")

