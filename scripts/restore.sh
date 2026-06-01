#!/bin/bash
# MongoDB Database Restore Script
# Usage: ./restore.sh <backup_name>

set -e

# Configuration
BACKUP_DIR="/app/backups"
MONGO_URI="${MONGO_URL:-mongodb://localhost:27017}"
DB_NAME="${MONGO_DB:-erp_database}"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if backup name provided
if [ -z "$1" ]; then
    echo -e "${RED}❌ Error: Backup name required${NC}"
    echo "Usage: ./restore.sh <backup_name>"
    echo ""
    echo "Available backups:"
    ls -1 "${BACKUP_DIR}" 2>/dev/null || echo "No backups found"
    exit 1
fi

BACKUP_NAME="$1"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

# Check if backup exists
if [ ! -d "${BACKUP_PATH}" ]; then
    echo -e "${RED}❌ Error: Backup '${BACKUP_NAME}' not found${NC}"
    echo "Available backups:"
    ls -1 "${BACKUP_DIR}" 2>/dev/null || echo "No backups found"
    exit 1
fi

echo -e "${RED}⚠️  WARNING: This will REPLACE the current database!${NC}"
echo "Backup: ${BACKUP_NAME}"
echo "Path: ${BACKUP_PATH}"
echo ""

# Show metadata if exists
if [ -f "${BACKUP_PATH}/metadata.json" ]; then
    echo "Backup info:"
    cat "${BACKUP_PATH}/metadata.json" | grep -E '(backup_name|created_at|size)' | sed 's/^/  /'
    echo ""
fi

read -p "Are you sure you want to continue? (yes/no): " -r
echo
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo -e "${YELLOW}Restore cancelled${NC}"
    exit 0
fi

echo -e "${YELLOW}🔄 Starting restore...${NC}"
echo ""

# Perform restore
echo -e "${YELLOW}📥 Running mongorestore...${NC}"
if mongorestore --uri="${MONGO_URI}" --drop --gzip "${BACKUP_PATH}" 2>&1; then
    echo ""
    echo -e "${GREEN}✅ Restore completed successfully!${NC}"
    echo -e "${GREEN}Database has been restored from: ${BACKUP_NAME}${NC}"
    exit 0
else
    echo ""
    echo -e "${RED}❌ Restore failed!${NC}"
    exit 1
fi
