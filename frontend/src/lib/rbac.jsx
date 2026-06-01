/**
 * rbac.jsx — Role-Based Access Control helpers for CV. Dewi Aditya ERP
 * 
 * Provides RequirePerm guard component and PermissionDenied fallback.
 */
import React from 'react';
import { Shield } from 'lucide-react';

/**
 * RequirePerm — Render children only if the user has the required permission.
 * 
 * @param {string}   perm      — Permission key to check (e.g. 'hr.view')
 * @param {function} hasPerm   — Function that checks a permission (returns boolean)
 * @param {string}   role      — User role ('superadmin' always passes)
 * @param {React.ReactNode} children  — Content to show when permitted
 * @param {React.ReactNode} fallback  — Content to show when denied (default: <PermissionDenied>)
 */
export function RequirePerm({ perm, hasPerm, role, children, fallback = null }) {
  // Superadmin bypasses all permission checks
  if (role === 'superadmin') return <>{children}</>;

  // Use hasPerm callback if provided
  if (typeof hasPerm === 'function') {
    if (hasPerm(perm)) return <>{children}</>;
  }

  // If no hasPerm function provided, allow by default (permissive fallback)
  if (!hasPerm) return <>{children}</>;

  return fallback !== null ? <>{fallback}</> : <PermissionDenied />;
}

/**
 * PermissionDenied — Default "access denied" UI shown inside a module.
 */
export function PermissionDenied({ message = 'Anda tidak memiliki akses ke fitur ini.' }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center gap-4">
      <div className="rounded-full bg-red-100 p-4">
        <Shield className="w-8 h-8 text-red-500" />
      </div>
      <h3 className="text-lg font-semibold text-gray-700">Akses Ditolak</h3>
      <p className="text-sm text-gray-500 max-w-xs">{message}</p>
    </div>
  );
}
