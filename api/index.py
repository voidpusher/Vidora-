from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from main import CourseTubeHandler, init_db


init_db()


class handler(CourseTubeHandler):
    pass
