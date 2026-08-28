"""Snapshot conversation memory + the rules ChromaDB index to Cloudflare R2.

Run via the `r2-backup` docker-compose profile (see docker-compose.yml). Not
wired into the default `docker-compose up` -- opt in with
`docker-compose --profile backup up`.

This is a single overwritten "latest" snapshot, not versioned history --
simplest thing that survives a VPS rebuild/redeploy. Enable R2 bucket
versioning (in the Cloudflare dashboard) if you want point-in-time history
instead.
"""

import argparse
import logging
import os
import sys
import time
from pathlib import Path

import boto3

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("backup_to_r2")

DATA_DIR = Path(os.getenv("BACKUP_DATA_DIR", "/app/data"))
CONVERSATIONS_DB = DATA_DIR / "conversations" / "conversations.db"
CHROMA_DIR = DATA_DIR / "chroma"


def _load_config() -> dict | None:
    account_id = os.getenv("R2_ACCOUNT_ID")
    access_key = os.getenv("R2_ACCESS_KEY_ID")
    secret_key = os.getenv("R2_SECRET_ACCESS_KEY")
    bucket = os.getenv("R2_BUCKET")
    if not all([account_id, access_key, secret_key, bucket]):
        return None
    return {
        "account_id": account_id,
        "access_key": access_key,
        "secret_key": secret_key,
        "bucket": bucket,
    }


def _client(config: dict):
    return boto3.client(
        "s3",
        endpoint_url=f"https://{config['account_id']}.r2.cloudflarestorage.com",
        aws_access_key_id=config["access_key"],
        aws_secret_access_key=config["secret_key"],
        region_name="auto",
    )


def run_backup(config: dict) -> None:
    s3 = _client(config)
    bucket = config["bucket"]

    if CONVERSATIONS_DB.exists():
        s3.upload_file(str(CONVERSATIONS_DB), bucket, "latest/conversations.db")
        logger.info("uploaded %s", CONVERSATIONS_DB)
    else:
        logger.info("skipping conversations.db: not found at %s", CONVERSATIONS_DB)

    if CHROMA_DIR.is_dir():
        count = 0
        for path in CHROMA_DIR.rglob("*"):
            if path.is_file():
                key = f"latest/chroma/{path.relative_to(CHROMA_DIR)}"
                s3.upload_file(str(path), bucket, key)
                count += 1
        logger.info("uploaded %d chroma file(s) from %s", count, CHROMA_DIR)
    else:
        logger.info("skipping chroma: not found at %s", CHROMA_DIR)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--loop",
        action="store_true",
        help="Run forever, backing up every R2_BACKUP_INTERVAL_SECONDS (default 3600).",
    )
    args = parser.parse_args()

    config = _load_config()
    if config is None:
        logger.info("R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET not "
                     "all set -- nothing to do.")
        sys.exit(0)

    interval = int(os.getenv("R2_BACKUP_INTERVAL_SECONDS", "3600"))

    if not args.loop:
        run_backup(config)
        return

    while True:
        try:
            run_backup(config)
        except Exception:
            logger.exception("backup run failed, will retry next interval")
        time.sleep(interval)


if __name__ == "__main__":
    main()
