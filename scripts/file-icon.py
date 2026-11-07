#!/usr/bin/env python3
"""Build NodeForge document icons with the shared Forge shell generator."""

import runpy
from pathlib import Path

runpy.run_path(str(Path(__file__).resolve().parents[1] / "node_modules/forge-shell/scripts/file-icon.py"), run_name="__main__")
