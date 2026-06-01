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
