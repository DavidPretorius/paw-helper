"""Validate extension resources and build a portable, verified release ZIP."""
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "extension"
manifest = json.loads((EXTENSION / "manifest.json").read_text(encoding="utf-8"))
references = [manifest["action"]["default_popup"], *manifest["icons"].values()]
for entry in manifest["content_scripts"]:
    references.extend(entry["js"])
for entry in manifest["web_accessible_resources"]:
    references.extend(entry["resources"])
for entry in json.loads((EXTENSION / "themes/index.json").read_text(encoding="utf-8")):
    references.append(entry["file"])
for reference in references:
    target = (EXTENSION / reference).resolve()
    if not target.is_relative_to(EXTENSION.resolve()) or not target.is_file():
        raise ValueError(f"Missing or invalid extension resource: {reference}")

files = sorted(p for p in EXTENSION.rglob("*") if p.is_file()
               and "tests" not in p.relative_to(EXTENSION).parts
               and p.name not in {".DS_Store", "Thumbs.db"})
output = ROOT / "dist" / f"paw-helper-{manifest['version']}.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for source in files:
        archive.write(source, "paw-helper/" + source.relative_to(EXTENSION).as_posix())
with ZipFile(output) as archive:
    if archive.testzip() is not None:
        raise RuntimeError("ZIP integrity check failed")
    for source in files:
        if archive.read("paw-helper/" + source.relative_to(EXTENSION).as_posix()) != source.read_bytes():
            raise RuntimeError(f"ZIP contents differ: {source.name}")
print(f"Verified {len(files)} files: {output}")
