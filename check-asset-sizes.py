#!/usr/bin/env python3
"""Asset size budget for Double Agent (mobile).

Run before pushing: python3 check-asset-sizes.py
Exit 0 = every asset is within budget for what it is.
Exit 1 = something is oversized and must be resized / recompressed
         before it ships — never just push a huge file and hope.

Budgets (standing, user-directed 2026-10-31):
  textures (assets/textures/*)  <= 2 MB each  (1179px textures are ~0.3-1.0 MB)
  character / model FBX         <= 5 MB each  (full textured models are ~1.5-3.6 MB)
  animation FBX                 <= 3 MB each  (most clips are 0.3-0.8 MB)
  weapon / prop GLB             <= 1 MB each  (current GLBs are 0.06-0.08 MB)
  all of assets/                <= 100 MB total (currently ~66 MB, and the
                                  browser only downloads the clips/textures
                                  a session actually uses, not the whole tree)

This script never modifies or deletes assets. It only reports.
An unused file is flagged separately (e.g. a duplicate texture no page
references) — flagging is not permission to delete a real user asset.
"""
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
BUDGETS = [
    ("assets/textures", 2 * 1024 * 1024, "texture"),
    ("assets/animations", 3 * 1024 * 1024, "animation"),
]
MODEL_BUDGET = 5 * 1024 * 1024
GLB_BUDGET = 1 * 1024 * 1024
TOTAL_BUDGET = 100 * 1024 * 1024

failures = []
warnings = []


def check(path, budget, kind):
    size = os.path.getsize(path)
    rel = os.path.relpath(path, ROOT)
    if size > budget:
        failures.append(f"FAIL {kind} over budget: {rel} = {size / 1048576:.2f} MB (limit {budget / 1048576:.0f} MB)")
    return size


total = 0
for dirpath, _, filenames in os.walk(os.path.join(ROOT, "assets")):
    for name in filenames:
        path = os.path.join(dirpath, name)
        total += os.path.getsize(path)
        rel = os.path.relpath(path, ROOT)
        if rel.startswith("assets/textures/"):
            check(path, BUDGETS[0][1], "texture")
        elif rel.startswith("assets/animations/"):
            check(path, BUDGETS[1][1], "animation")
        elif name.endswith(".fbx") and rel.startswith("assets/"):
            check(path, MODEL_BUDGET, "model")
        elif name.endswith(".glb"):
            check(path, GLB_BUDGET, "GLB")

# Unused textures: referenced nowhere in the playable pages.
pages = ""
for page in ("index.html", "ballroom.html"):
    with open(os.path.join(ROOT, page), encoding="utf-8", errors="ignore") as f:
        pages += f.read()
tex_dir = os.path.join(ROOT, "assets/textures")
if os.path.isdir(tex_dir):
    for name in sorted(os.listdir(tex_dir)):
        if name not in pages:
            warnings.append(f"UNUSED texture (no page references it): assets/textures/{name} — flagged, not deleted")

print(f"assets total: {total / 1048576:.1f} MB (limit {TOTAL_BUDGET / 1048576:.0f} MB)")
if total > TOTAL_BUDGET:
    failures.append(f"FAIL assets total over budget: {total / 1048576:.1f} MB")
for w in warnings:
    print("WARN " + w)
for f in failures:
    print(f)
print("PASS — all assets within budget" if not failures else "FAILED — fix the items above before pushing")
sys.exit(1 if failures else 0)
