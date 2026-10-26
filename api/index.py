"""Vercel entry point: serves the FastAPI app as a Python function.

vercel.json rewrites /api/* here; FastAPI receives the original path, so the
routes in backend/app/main.py (all under /api) match unchanged.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.main import app  # noqa: E402,F401  (Vercel looks for a top-level `app`)
