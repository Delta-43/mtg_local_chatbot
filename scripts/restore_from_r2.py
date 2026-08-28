"""Restore conversation memory + the rules ChromaDB index from the "latest"
snapshot written by scripts/backup_to_r2.py.

Not wired into docker-compose as a standing service (unlike the `backup`
profile) -- this is a one-off operator tool. Run it via the same image, e.g.:

    docker compose run --rm r2-backup python -m scripts.restore_from_r2 --yes

Stop mtg-judge and rules-mcp first: this overwrites the SQLite conversation
DB and the Chroma persist dir out from under any process that has them open,
which is asking for the same "readonly database" trouble documented in
rules_mcp/ingestor.py.
"""

import argparse
import logging
import os
import sys
from pathlib import Path

import boto3

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("restore_from_r2")

DATA_DIR = Path(os.getenv("BACKUP_DATA_DIR", "/app/data"))


def _load_config() -> dict:
    missing = [
        name
        for name in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
        if not os.getenv(name)
    ]
    if missing:
        logger.error("Missing required env var(s): %s", ", ".join(missing))
        sys.exit(1)
    return {
        "account_id": os.environ["R2_ACCOUNT_ID"],
        "access_key": os.environ["R2_ACCESS_KEY_ID"],
        "secret_key": os.environ["R2_SECRET_ACCESS_KEY"],
        "bucket": os.environ["R2_BUCKET"],
    }


def _client(config: dict):
    return boto3.client(
        "s3",
        endpoint_url=f"https://{config['account_id']}.r2.cloudflarestorage.com",
        aws_access_key_id=config["access_key"],
        aws_secret_access_key=config["secret_key"],
        region_name="auto",
    )


def _list_latest_objects(s3, bucket: str) -> list[str]:
    keys = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix="latest/"):
        for obj in page.get("Contents", []):
            keys.append(obj["Key"])
    return keys


def _local_path_for_key(key: str) -> Path:
    # Mirrors backup_to_r2.py's upload keys exactly: conversations.db is
    # flattened straight under latest/, not nested under a conversations/
    # prefix, unlike chroma/ -- Path(key).relative_to("latest") alone would
    # put it at data/conversations.db instead of data/conversations/conversations.db.
    if key == "latest/conversations.db":
        return DATA_DIR / "conversations" / "conversations.db"
    return DATA_DIR / Path(key).relative_to("latest")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Actually download and overwrite local files. Without this flag, "
        "only lists what would be restored.",
    )
    args = parser.parse_args()

    config = _load_config()
    s3 = _client(config)
    keys = _list_latest_objects(s3, config["bucket"])

    if not keys:
        logger.info("No objects found under latest/ in bucket %s -- nothing to restore.", config["bucket"])
        return

    if not args.yes:
        logger.info("Dry run (pass --yes to actually restore). Would download %d object(s):", len(keys))
        for key in keys:
            logger.info("  %s -> %s", key, _local_path_for_key(key))
        return

    for key in keys:
        dest = _local_path_for_key(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        s3.download_file(config["bucket"], key, str(dest))
        logger.info("restored %s -> %s", key, dest)

    logger.info("Restored %d object(s) from R2 into %s.", len(keys), DATA_DIR)


if __name__ == "__main__":
    main()
