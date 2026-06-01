"""dewi_rnd — thin orchestrator.

Semua endpoint hidup di sub-modul; file ini hanya mengimport mereka
sehingga @router.get/@router.post decorator terdaftar di shared router.

Split dari monolith 1533 LOC → 7 modul ≤ 320 LOC masing-masing.
"""
from routes.dewi_rnd_shared import router  # noqa: F401  (re-exported for server.py)
import routes.dewi_rnd_styles    # noqa: F401
import routes.dewi_rnd_samples   # noqa: F401
import routes.dewi_rnd_materials  # noqa: F401
import routes.dewi_rnd_design    # noqa: F401
import routes.dewi_rnd_hpp       # noqa: F401
import routes.dewi_rnd_overview  # noqa: F401
