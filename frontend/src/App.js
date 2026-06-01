import { useState, useEffect, useCallback, Suspense, useMemo, lazy } from 'react';
import './App.css';
import Login from './components/erp/Login';
import PortalSelector from './components/erp/PortalSelector';
import PortalShell from './components/erp/PortalShell';
import { MODULE_REGISTRY, DEFAULT_MODULE } from './components/erp/moduleRegistry';
import { PORTAL_NAV } from './components/erp/portal-shell/portalNav';
import { ThemeProvider } from './components/theme/ThemeProvider';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import { clientApi } from './components/client/clientApi';
import { configureApi } from './lib/apiFetch';
import ErrorBoundary from './components/ErrorBoundary';
// Pre-Dev Health Check (2026-05-26): RC-2 fix — chunk retry + fallback
import { lazyWithRetry } from './lib/lazyWithRetry';

// Session #11.18 EXTENDED — Performance optimization: lazy-load alternate portal UIs
// Sprint A.0 + Pre-Dev Health Check: wrapped with lazyWithRetry to survive network blips
const OperatorView      = lazy(lazyWithRetry(() => import('./components/erp/OperatorView'), 'OperatorView'));
const ShopFloorTV       = lazy(lazyWithRetry(() => import('./components/erp/ShopFloorTV'), 'ShopFloorTV'));
const AIChatbotWidget   = lazy(lazyWithRetry(() => import('./components/erp/AIChatbotWidget'), 'AIChatbotWidget'));
const ClientLogin       = lazy(lazyWithRetry(() => import('./components/client/ClientLogin'), 'ClientLogin'));
const ClientPortalShell = lazy(lazyWithRetry(() => import('./components/client/ClientPortalShell'), 'ClientPortalShell'));
const CreatorPortalApp  = lazy(lazyWithRetry(() => import('./components/creator/CreatorPortalApp'), 'CreatorPortalApp'));
const LiveHostPortalApp = lazy(lazyWithRetry(() => import('./components/livehost/LiveHostPortalApp'), 'LiveHostPortalApp'));
const VendorCMTPortalApp= lazy(lazyWithRetry(() => import('./components/vendor-cmt/VendorCMTPortalApp'), 'VendorCMTPortalApp'));
const AbsenPage         = lazy(lazyWithRetry(() => import('./pages/AbsenPage'), 'AbsenPage'));

// Loading fallback for portal-level Suspense
const PortalLoader = () => (
  <div className="min-h-screen grid place-items-center bg-background">
    <div className="flex flex-col items-center gap-3">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[hsl(var(--primary))]" />
      <p className="text-sm text-muted-foreground">Memuat portal...</p>
    </div>
  </div>
);

// Default module untuk tiap portal
const PORTAL_DEFAULT_MODULE = {
  management: 'management-dashboard',
  production: 'production-dashboard',
  warehouse:  'warehouse-dashboard',
  finance:    'finance-dashboard',
  hr:         'hr-dashboard',
  maklon:     'maklon-dashboard',
  toko:       'toko-dashboard',
  rnd:        'rnd-dashboard',
  self:       'self-dashboard',
  collaboration: 'collaboration',  // NEW: Unified Communication + Workspace + Learning
  assets:     'asset-dashboard',
  accessories: 'accessories-dashboard',  // Session #11.21 — Portal Aksesoris
};

const VALID_PORTALS = Object.keys(PORTAL_DEFAULT_MODULE);

// Session #11.14 — Find which portal "owns" a given moduleId. Used for deep-linking
// via URL hash (e.g. `/#prod-shipments` should auto-open the Production portal
// with that module loaded). For modules removed from sidebar (e.g. deprecated
// modules like `prod-shipments`, `do-management`), this scans the legacy portal
// mappings as a fallback.
//
// Returns the portalId (e.g. 'production') or null if module is unknown.
const LEGACY_MODULE_TO_PORTAL = {
  // P2 Consolidation #12 deprecated modules — kept reachable via direct URL hash
  'prod-shipments': 'production',
  'do-management': 'warehouse',
};

function findPortalForModule(moduleId) {
  if (!moduleId) return null;
  // 1) Check legacy fallback (deprecated modules removed from sidebar)
  if (LEGACY_MODULE_TO_PORTAL[moduleId]) {
    return LEGACY_MODULE_TO_PORTAL[moduleId];
  }
  // 2) Scan active portal nav sections (supports flat items + nested groups)
  for (const [portalId, nav] of Object.entries(PORTAL_NAV || {})) {
    if (!nav || !Array.isArray(nav.sections)) continue;
    for (const section of nav.sections) {
      const items = section.items || [];
      if (items.some((it) => it.id === moduleId)) return portalId;
      // Walk nested groups (used by Production portal & others)
      const groups = section.groups || [];
      for (const g of groups) {
        const gItems = g.items || [];
        if (gItems.some((it) => it.id === moduleId)) return portalId;
      }
    }
  }
  return null;
}

// Parse moduleId from URL hash. Supports both `#module-id` and `#module-id=subkey`
// (the `=subkey` part is consumed by the module itself, e.g. CuttingHub tabs).
function parseModuleHash() {
  if (typeof window === 'undefined') return null;
  const raw = window.location.hash || '';
  if (!raw) return null;
  const hash = raw.replace(/^#/, '');
  const moduleId = hash.split('=')[0].trim();
  return moduleId || null;
}

const ModuleSpinner = () => (
  <div className="flex items-center justify-center h-64">
    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[hsl(var(--primary))]" />
  </div>
);

// Deteksi apakah URL saat ini /operator
const isOperatorRoute = () => {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith('/operator');
};

// Deteksi apakah URL saat ini /tv
const isTVRoute = () => {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith('/tv');
};

// Deteksi apakah URL saat ini /client (Portal Klien Maklon)
const isClientRoute = () => {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith('/client');
};

// Deteksi apakah URL saat ini /creator (Portal Creator KOL)
const isCreatorRoute = () => {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith('/creator');
};

// Deteksi apakah URL saat ini /livehost (Portal LiveHost - Phase 4)
const isLiveHostRoute = () => {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith('/livehost');
};

// Deteksi apakah URL saat ini /absen (Portal Absen Mandiri)
const isAbsenRoute = () => {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith('/absen');
};

// Deteksi apakah URL saat ini /vendor-cmt (Portal Vendor CMT)
const isVendorCMTRoute = () => {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith('/vendor-cmt');
};

function ClientPortalApp() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    const sess = clientApi.loadSession();
    if (sess) {
      setToken(sess.token);
      setUser(sess.user);
    }
    setBootstrapped(true);
  }, []);

  const handleLogin = useCallback((tokenData, userData) => {
    setToken(tokenData);
    setUser(userData);
  }, []);

  const handleLogout = useCallback(() => {
    clientApi.clearSession();
    setToken(null);
    setUser(null);
  }, []);

  if (!bootstrapped) {
    return (
      <div className="flex items-center justify-center h-screen bg-[hsl(var(--background))]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[hsl(var(--primary))]"></div>
      </div>
    );
  }

  if (!token || !user) {
    return (
      <Suspense fallback={<PortalLoader />}>
        <ClientLogin onLogin={handleLogin} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<PortalLoader />}>
      <ClientPortalShell token={token} user={user} onLogout={handleLogout} />
    </Suspense>
  );
}

function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedPortal, setSelectedPortal] = useState(null);
  const [currentModule, setCurrentModule] = useState('management-dashboard');
  const [operatorRoute, setOperatorRoute] = useState(isOperatorRoute());
  const [tvRoute, setTVRoute] = useState(isTVRoute());
  const [clientRoute, setClientRoute] = useState(isClientRoute());
  const [creatorRoute, setCreatorRoute] = useState(isCreatorRoute());
  const [liveHostRoute, setLiveHostRoute] = useState(isLiveHostRoute());
  const [absenRoute, setAbsenRoute] = useState(isAbsenRoute());
  const [vendorCMTRoute, setVendorCMTRoute] = useState(isVendorCMTRoute());

  // Sync operatorRoute on popstate / navigation
  useEffect(() => {
    const onPop = () => {
      setOperatorRoute(isOperatorRoute());
      setTVRoute(isTVRoute());
      setClientRoute(isClientRoute());
      setCreatorRoute(isCreatorRoute());
      setLiveHostRoute(isLiveHostRoute());
      setAbsenRoute(isAbsenRoute());
      setVendorCMTRoute(isVendorCMTRoute());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Restore session
  useEffect(() => {
    const savedToken = localStorage.getItem('erp_token');
    const savedUser = localStorage.getItem('erp_user');
    const savedPortal = localStorage.getItem('erp_portal');
    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        const parsed = JSON.parse(savedUser);
        setUser(parsed);
        if (savedPortal && VALID_PORTALS.includes(savedPortal)) {
          setSelectedPortal(savedPortal);
          setCurrentModule(PORTAL_DEFAULT_MODULE[savedPortal]);
        }
        
        // EEM Phase B — URL query parameter deep-link support (?portal=X&module=Y)
        // Priority: URL params > hash > localStorage
        const params = new URLSearchParams(window.location.search);
        const urlPortal = params.get('portal');
        const urlModule = params.get('module');
        
        if (urlPortal && urlModule && VALID_PORTALS.includes(urlPortal) && MODULE_REGISTRY[urlModule]) {
          setSelectedPortal(urlPortal);
          setCurrentModule(urlModule);
          localStorage.setItem('erp_portal', urlPortal);
        } else {
          // Session #11.14 — Deep-link via URL hash (#module-id). If a hash is
          // present and resolves to a known module, override the portal+module.
          const hashModuleId = parseModuleHash();
          if (hashModuleId && MODULE_REGISTRY[hashModuleId]) {
            const portalForHash = findPortalForModule(hashModuleId);
            if (portalForHash && VALID_PORTALS.includes(portalForHash)) {
              setSelectedPortal(portalForHash);
              setCurrentModule(hashModuleId);
              localStorage.setItem('erp_portal', portalForHash);
            }
          }
        }
      } catch (e) {
        localStorage.removeItem('erp_token');
        localStorage.removeItem('erp_user');
        localStorage.removeItem('erp_portal');
      }
    }
    setLoading(false);
  }, []);

  // Session #11.14 — Listen to hashchange events for in-app deep-link navigation
  // (e.g. user pastes a URL with `#prod-shipments` while already logged in).
  useEffect(() => {
    const onHashChange = () => {
      const hashModuleId = parseModuleHash();
      if (!hashModuleId || !MODULE_REGISTRY[hashModuleId]) return;
      const portalForHash = findPortalForModule(hashModuleId);
      if (portalForHash && VALID_PORTALS.includes(portalForHash)) {
        setSelectedPortal(portalForHash);
        setCurrentModule(hashModuleId);
        localStorage.setItem('erp_portal', portalForHash);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Configure apiFetch wrapper with 401 auto-logout handler (runs once on mount)
  useEffect(() => {
    configureApi({
      onUnauthorized: () => {
        // Clear session storage and trigger re-render to Login
        localStorage.removeItem('erp_token');
        localStorage.removeItem('erp_user');
        localStorage.removeItem('erp_portal');
        setToken(null);
        setUser(null);
        setSelectedPortal(null);
      },
    });
  }, []);

  const handleLogin = useCallback((tokenData, userData) => {
    setToken(tokenData);
    setUser(userData);
    localStorage.setItem('erp_token', tokenData);
    localStorage.setItem('erp_user', JSON.stringify(userData));
    
    // Role operator → redirect ke Operator View
    if ((userData.role || '').toLowerCase() === 'operator') {
      window.history.pushState({}, '', '/operator');
      setOperatorRoute(true);
      return;
    }
    
    // EEM Phase B — Check URL query params after login for direct navigation
    const params = new URLSearchParams(window.location.search);
    const urlPortal = params.get('portal');
    const urlModule = params.get('module');
    
    if (urlPortal && urlModule && VALID_PORTALS.includes(urlPortal) && MODULE_REGISTRY[urlModule]) {
      // Direct navigation via URL params
      setSelectedPortal(urlPortal);
      setCurrentModule(urlModule);
      localStorage.setItem('erp_portal', urlPortal);
    } else {
      // Default: back to portal selector
      setSelectedPortal(null);
      setCurrentModule('management-dashboard');
    }
  }, []);

  const handleLogout = useCallback(() => {
    setToken(null);
    setUser(null);
    setSelectedPortal(null);
    setCurrentModule('management-dashboard');
    localStorage.removeItem('erp_token');
    localStorage.removeItem('erp_user');
    localStorage.removeItem('erp_portal');
    if (isOperatorRoute()) {
      window.history.pushState({}, '', '/');
      setOperatorRoute(false);
    }
  }, []);

  const handleSelectPortal = useCallback((portalId) => {
    if (!VALID_PORTALS.includes(portalId)) return;
    setSelectedPortal(portalId);
    setCurrentModule(PORTAL_DEFAULT_MODULE[portalId]);
    localStorage.setItem('erp_portal', portalId);
  }, []);

  // Hybrid-nav support: switch portal dari pill-nav tanpa balik ke selector
  const handlePortalChange = useCallback((portalId) => {
    if (!VALID_PORTALS.includes(portalId)) return;
    setSelectedPortal(portalId);
    setCurrentModule(PORTAL_DEFAULT_MODULE[portalId]);
    localStorage.setItem('erp_portal', portalId);
  }, []);

  const handleBackToPortals = useCallback(() => {
    setSelectedPortal(null);
    setCurrentModule('management-dashboard');
    localStorage.removeItem('erp_portal');
  }, []);

  const [navParams, setNavParams] = useState({});

  const handleNavigate = useCallback((moduleId, params = {}) => {
    setCurrentModule(moduleId);
    setNavParams(params || {});
  }, []);

  // ── Memoize headers to prevent infinite re-render in child components ──
  // MUST be before any conditional returns (Rules of Hooks)
  const headers = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[hsl(var(--background))]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[hsl(var(--primary))]"></div>
      </div>
    );
  }

  // TV Mode (Phase 18C) — public, no auth required
  if (tvRoute) {
    return (
      <Suspense fallback={<PortalLoader />}>
        <ShopFloorTV />
      </Suspense>
    );
  }

  // Absen Mandiri Portal — dedicated attendance page
  if (absenRoute) {
    return (
      <Suspense fallback={<PortalLoader />}>
        <AbsenPage />
      </Suspense>
    );
  }

  // Vendor CMT Portal — separate app for CMT vendors
  if (vendorCMTRoute) {
    return (
      <Suspense fallback={<PortalLoader />}>
        <VendorCMTPortalApp />
      </Suspense>
    );
  }

  // Client Portal (Phase 4) — separate app, separate auth, separate token storage
  if (clientRoute) {
    return <ClientPortalApp />;
  }

  // Creator Portal (Phase 5) — separate app for KOL creators
  if (creatorRoute) {
    return (
      <Suspense fallback={<PortalLoader />}>
        <CreatorPortalApp />
      </Suspense>
    );
  }

  // LiveHost Portal (Phase 4 / Session 28) — separate app for live streaming hosts
  if (liveHostRoute) {
    return (
      <Suspense fallback={<PortalLoader />}>
        <LiveHostPortalApp />
      </Suspense>
    );
  }

  if (!token || !user) return <Login onLogin={handleLogin} />;

  // Operator View (mobile) on /operator URL OR if user role is operator
  if (operatorRoute || (user.role || '').toLowerCase() === 'operator') {
    return (
      <Suspense fallback={<PortalLoader />}>
        <OperatorView user={user} token={token} onLogout={handleLogout} />
      </Suspense>
    );
  }

  if (!selectedPortal) {
    return <PortalSelector user={user} onSelectPortal={handleSelectPortal} onLogout={handleLogout} />;
  }

  const userPerms = user?.permissions || [];
  const hasPerm = (key) => {
    const role = (user?.role || '').toLowerCase();
    if (['superadmin', 'admin', 'owner'].includes(role)) return true;
    return userPerms.includes(key) || userPerms.includes(key.split('.')[0] + '.*') || userPerms.includes('*');
  };

  const ModuleComponent = MODULE_REGISTRY[currentModule] || DEFAULT_MODULE;

  // Special handling for Portal Kolaborasi - render full screen without PortalShell wrapper
  if (selectedPortal === 'collaboration') {
    return (
      <>
        <Suspense fallback={<ModuleSpinner />}>
          <ModuleComponent
            token={token}
            user={user}
            headers={headers}
            userRole={user?.role}
            hasPerm={hasPerm}
            onNavigate={handleNavigate}
            onLogout={handleLogout}
            onBack={handleBackToPortals}
            moduleId={currentModule}
            deepLinkParams={navParams}
          />
        </Suspense>
        {/* Global AI Chatbot Widget */}
        <Suspense fallback={null}>
          <AIChatbotWidget headers={headers} user={user} />
        </Suspense>
      </>
    );
  }

  // Standard portal rendering with PortalShell
  return (
    <>
      <PortalShell
        portal={selectedPortal}
        user={user}
        token={token}
        onBack={handleBackToPortals}
        onLogout={handleLogout}
        onPortalChange={handlePortalChange}
        currentModule={currentModule}
        onModuleChange={setCurrentModule}
      >
        <Suspense fallback={<ModuleSpinner />}>
          <ModuleComponent
            token={token}
            user={user}
            headers={headers}
            userRole={user?.role}
            hasPerm={hasPerm}
            onNavigate={handleNavigate}
            moduleId={currentModule}
            deepLinkParams={navParams}
            onModuleChange={setCurrentModule}
          />
        </Suspense>
      </PortalShell>
      {/* Global AI Chatbot Widget — available on all portals */}
      <Suspense fallback={null}>
        <AIChatbotWidget headers={headers} user={user} />
      </Suspense>
    </>
  );
}

export default function AppWithTheme() {
  return (
    <ErrorBoundary level="root">
      <ThemeProvider defaultTheme="system">
        <TooltipProvider delayDuration={250}>
          {/* Ambient decorative layers — pointer-events none, behind everything */}
          <div className="starfield" aria-hidden="true" />
          <div className="noise-overlay fixed inset-0 pointer-events-none" aria-hidden="true" />
          <App />
          <Toaster position="top-right" richColors closeButton />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
