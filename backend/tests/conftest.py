import sys
from pathlib import Path

# Make `app` and `tests.helpers` importable when pytest runs from backend/.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
