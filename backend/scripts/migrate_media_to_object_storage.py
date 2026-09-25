from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import MEDIA_ROOT, MEDIA_STORAGE_BACKEND
from app.media_storage import (
    guess_content_type,
    media_exists,
    put_media_bytes,
    validate_media_storage,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Upload the existing local media tree to the configured S3-compatible "
            "object store while preserving database object keys."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List files without uploading them.",
    )
    args = parser.parse_args()

    if MEDIA_STORAGE_BACKEND != "s3":
        parser.error("Set MEDIA_STORAGE_BACKEND=s3 before running this migration")
    source_root = Path(MEDIA_ROOT).resolve()
    if not source_root.is_dir():
        print(f"No local media directory found at {source_root}")
        return 0

    validate_media_storage()
    files = sorted(path for path in source_root.rglob("*") if path.is_file())
    uploaded = 0
    skipped = 0
    for path in files:
        key = path.relative_to(source_root).as_posix()
        if path.name.startswith("."):
            skipped += 1
            continue
        if args.dry_run:
            print(f"would upload {key}")
            continue
        data = path.read_bytes()
        put_media_bytes(
            key,
            data,
            content_type=guess_content_type(path.name),
        )
        if not media_exists(key):
            print(f"upload verification failed: {key}", file=sys.stderr)
            return 1
        uploaded += 1
        print(f"uploaded {key}")

    if args.dry_run:
        print(f"{len(files) - skipped} file(s) ready to upload; {skipped} skipped")
    else:
        print(f"{uploaded} file(s) uploaded and verified; {skipped} skipped")
        print("Local files were retained. Delete them only after application verification.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
