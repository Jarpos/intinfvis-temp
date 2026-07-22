#!/usr/bin/env python3
"""Build deterministic monthly delay bundles from the authoritative daily CSVs."""

from __future__ import annotations

import csv
import json
import shutil
from pathlib import Path
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "bahn" / "csv" / "delays"
OUTPUT = ROOT / "data" / "bahn" / "optimized" / "delays"
FIELDS = (
    "date",
    "from_stop_id",
    "to_stop_id",
    "delay_count",
    "entries_count",
    "avg_delay",
)


def write_monthly_bundles(source_dir: Path, output_dir: Path) -> list[str]:
    files_by_month: dict[str, list[Path]] = {}
    for path in sorted(source_dir.glob("*.csv")):
        date = path.stem
        files_by_month.setdefault(date[:7], []).append(path)

    output_dir.mkdir(parents=True, exist_ok=True)
    months: list[str] = []

    for month, paths in sorted(files_by_month.items()):
        months.append(month)
        output_path = output_dir / f"{month}.csv"
        with output_path.open("w", newline="", encoding="utf-8") as target:
            writer = csv.DictWriter(target, fieldnames=FIELDS, lineterminator="\n")
            writer.writeheader()
            for path in paths:
                with path.open(newline="", encoding="utf-8") as source:
                    for row in csv.DictReader(source):
                        writer.writerow(
                            {
                                "date": path.stem,
                                "from_stop_id": row["from_stop_id"],
                                "to_stop_id": row["to_stop_id"],
                                "delay_count": row["delay_count"],
                                "entries_count": row["entries_count"],
                                "avg_delay": row["avg_delay"],
                            }
                        )

    return months


def main() -> None:
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)

    manifest: dict[str, object] = {
        "version": 1,
        "ic": write_monthly_bundles(SOURCE / "ic", OUTPUT / "ic"),
        "non_ic": {},
    }

    non_ic_manifest: dict[str, dict[str, object]] = {}
    for region_dir in sorted(path for path in (SOURCE / "non_ic").iterdir() if path.is_dir()):
        encoded_region = quote(region_dir.name, safe="")
        non_ic_manifest[region_dir.name] = {
            "path": encoded_region,
            "months": write_monthly_bundles(
                region_dir,
                OUTPUT / "non_ic" / region_dir.name,
            ),
        }

    manifest["non_ic"] = non_ic_manifest
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
