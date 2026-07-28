import re
import os
import json
import logging
import hashlib
import requests
from pathlib import Path
from datetime import datetime
from bs4 import BeautifulSoup
from pdfminer.high_level import extract_text
from pdfminer.layout import LAParams
from pdfminer.pdfpage import PDFPage
from config import Config

logging.basicConfig(level=getattr(logging, Config.LOG_LEVEL))
logger = logging.getLogger(__name__)

class MTGRulesPDFParser:
    def __init__(self):
        self.data_dir = Path(Config.PDF_PARSER_DIR)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.pdf_path = self.data_dir / Config.RULES_PDF_FILENAME
        self.json_path = self.data_dir / Config.RULES_JSON_FILENAME

        self.laparams = LAParams(
            line_overlap=0.5,
            char_margin=2.0,
            line_margin=0.5,
            word_margin=0.1
        )

        self.chapter_pattern = re.compile(r'^(\d{1})\.\s+(.+)$', re.MULTILINE)
        self.section_pattern = re.compile(r'^(\d{3})\.\s+(.+)$', re.MULTILINE)
        self.rule_pattern = re.compile(r'^(\d{3}\.\d+)\.\s+(.+)$', re.MULTILINE)
        self.subrule_pattern = re.compile(r'^(\d{3}\.\d+[a-z])\.?\s+(.+)$', re.MULTILINE)

    def _is_valid_chapter_heading(self, line: str) -> bool:
        # e.g. "1. Game Concepts" - single digit, title-like text, no trailing period
        return bool(re.match(r'^\d\.\s+[A-Z].*[a-zA-Z\)\"!]$', line.strip()))

    def _is_valid_section_heading(self, line: str) -> bool:
        # e.g. "100. General" - three digits, title-like text, no trailing period
        return bool(re.match(r'^\d{3}\.\s+[A-Z].*[a-zA-Z\)\"!]$', line.strip()))

    def _ends_with_terminal(self, text: str) -> bool:
        return text.strip()[-1:] in {'.', ')', '"'}

    def _merge_pdf_lines(self, lines: list) -> list:
        merged = []
        buffer = ""
        for line in lines:
            line = line.strip()
            if not line:
                continue
            if (self.chapter_pattern.match(line) or
                self.section_pattern.match(line) or
                self.rule_pattern.match(line) or
                self.subrule_pattern.match(line)):
                if buffer:
                    merged.append(buffer)
                    buffer = ""
                buffer = line
            else:
                buffer += " " + line
        if buffer:
            merged.append(buffer)
        return merged

    def _get_latest_rules_url(self) -> str:
        headers = {"User-Agent": "Mozilla/5.0 (compatible; MTG-Judge-Bot/1.0)"}
        try:
            response = requests.get(Config.MTG_RULES_INDEX_URL, timeout=30, headers=headers)
            response.raise_for_status()
            # The WotC rules page may load links via JS; search the raw HTML with regex
            # for any MagicCompRules PDF URL, then also try parsed anchors.
            candidates = set(re.findall(
                r'https?://media\.wizards\.com/\d{4}/downloads/(?:rules/)?MagicCompRules[^"\'\s]+\.pdf',
                response.text
            ))
            soup = BeautifulSoup(response.text, 'html.parser')
            for link in soup.find_all('a', href=re.compile(r'MagicCompRules.*\.pdf')):
                href = link.get('href', '')
                if href.endswith('.pdf'):
                    candidates.add(href)
            if candidates:
                # PDF filenames embed a date (MagicCompRules YYYYMMDD.pdf); pick the newest.
                def date_key(url: str) -> str:
                    m = re.search(r'(\d{8})', url)
                    return m.group(1) if m else "00000000"
                latest = max(candidates, key=date_key)
                logger.info(f"Found latest rules PDF link: {latest}")
                return latest
            logger.warning("Could not find PDF link on rules index page, using fallback URL")
        except Exception as e:
            logger.warning(f"Failed to fetch rules index page: {e}")
        logger.info(f"Using configured fallback rules URL: {Config.MTG_RULES_URL}")
        return Config.MTG_RULES_URL

    def _file_needs_update(self) -> bool:
        if not self.pdf_path.exists():
            logger.info("Local PDF not found. Will download.")
            return True
        headers = {"User-Agent": "Mozilla/5.0 (compatible; MTG-Judge-Bot/1.0)"}
        try:
            url = self._get_latest_rules_url()
            response = requests.head(url, timeout=10, allow_redirects=True, headers=headers)
            if response.status_code == 200:
                remote_last_modified = response.headers.get("Last-Modified")
                local_mtime = self.pdf_path.stat().st_mtime
                if remote_last_modified:
                    from email.utils import parsedate_to_datetime
                    try:
                        remote_dt = parsedate_to_datetime(remote_last_modified)
                        remote_ts = remote_dt.timestamp()
                        if remote_ts > local_mtime + 3600:
                            logger.info(f"Remote PDF updated (remote: {remote_last_modified}, local mtime: {datetime.fromtimestamp(local_mtime)})")
                            return True
                        logger.info("Local PDF is current based on Last-Modified header.")
                        return False
                    except Exception:
                        pass
                logger.info("Could not determine remote Last-Modified, falling back to content hash check")
                response = requests.get(url, timeout=120, stream=True, headers=headers)
                if response.status_code == 200:
                    remote_hash = hashlib.md5()
                    for chunk in response.iter_content(chunk_size=8192):
                        remote_hash.update(chunk)
                    local_hash = hashlib.md5(self.pdf_path.read_bytes()).hexdigest()
                    return remote_hash.hexdigest() != local_hash
        except Exception as e:
            logger.warning(f"Could not check for updates: {e}")
        return False

    def download_rules_pdf(self) -> bool:
        url = self._get_latest_rules_url()
        logger.info(f"Downloading MTG rules PDF from: {url}")
        headers = {"User-Agent": "Mozilla/5.0 (compatible; MTG-Judge-Bot/1.0)"}
        try:
            response = requests.get(url, timeout=120, stream=True, headers=headers)
            response.raise_for_status()
            with open(self.pdf_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            logger.info(f"Successfully downloaded rules PDF to: {self.pdf_path}")
            return True
        except Exception as e:
            logger.error(f"Failed to download rules PDF: {e}")
            return False

    def parse_pdf(self) -> dict:
        if not self.pdf_path.exists():
            logger.error(f"PDF file not found: {self.pdf_path}")
            return None

        logger.info(f"Parsing PDF: {self.pdf_path}")
        try:
            with open(self.pdf_path, "rb") as f:
                total_pages = sum(1 for _ in PDFPage.get_pages(f))
            page_indices = list(range(4, total_pages))

            text = extract_text(
                str(self.pdf_path),
                page_numbers=page_indices,
                laparams=self.laparams
            )
        except Exception as e:
            logger.error(f"Failed to extract text from PDF: {e}")
            return None

        clean_text = self._merge_pdf_lines(text.splitlines())

        hierarchy = []
        current_chapter = None
        current_section = None
        current_rule_id = None
        rule_text = []
        subrule_buffer = []

        def flush_rule():
            nonlocal current_rule_id, rule_text, subrule_buffer, current_section
            if current_rule_id and rule_text and current_section:
                check_text = ' '.join(rule_text).strip()
                if self._ends_with_terminal(check_text):
                    current_section["rules"].append({
                        "rule_id": current_rule_id,
                        "text": " ".join(rule_text).strip(),
                        "subrules": subrule_buffer if subrule_buffer else []
                    })
                else:
                    logger.warning(f"Warning: Odd rule ending detected - {check_text}")
            current_rule_id = None
            rule_text = []
            subrule_buffer = []

        def flush_section():
            nonlocal current_section, current_chapter
            if current_section and current_chapter:
                current_chapter["sections"].append(current_section)
            current_section = None

        def flush_chapter():
            nonlocal current_chapter
            if current_chapter:
                hierarchy.append(current_chapter)
            current_chapter = None

        for line in clean_text:
            line = line.strip()
            if not line:
                continue

            subrule_match = self.subrule_pattern.match(line)
            rule_match = self.rule_pattern.match(line)
            section_match = self.section_pattern.match(line)
            chapter_match = self.chapter_pattern.match(line)

            # Order matters: check most specific (subrule/rule) before section/chapter.
            if subrule_match:
                subrule_buffer.append({
                    "subrule_id": subrule_match.group(1),
                    "text": subrule_match.group(2).strip()
                })
            elif rule_match:
                flush_rule()
                current_rule_id = rule_match.group(1)
                rule_text = [rule_match.group(2).strip()]
                subrule_buffer = []
            elif section_match and self._is_valid_section_heading(line):
                flush_rule()
                flush_section()
                current_section = {
                    "section_id": section_match.group(1),
                    "section_title": section_match.group(2),
                    "rules": []
                }
            elif chapter_match and self._is_valid_chapter_heading(line):
                flush_rule()
                flush_section()
                flush_chapter()
                current_chapter = {
                    "heading": line,
                    "sections": []
                }
            else:
                if subrule_buffer:
                    subrule_buffer[-1]["text"] += " " + line
                elif current_rule_id:
                    rule_text.append(line)

        flush_rule()
        flush_section()
        flush_chapter()

        with open(self.json_path, "w", encoding="utf-8") as f:
            json.dump(hierarchy, f, ensure_ascii=False, indent=2)

        logger.info(f"Parsing complete. Saved to: {self.json_path}")
        return hierarchy


def main():
    parser = MTGRulesPDFParser()

    if parser._file_needs_update() or not parser.pdf_path.exists():
        logger.info("Rules PDF needs update. Downloading...")
        if parser.download_rules_pdf():
            logger.info("PDF downloaded. Parsing...")
            parser.parse_pdf()
        else:
            logger.error("Failed to download PDF. Using existing file if available.")
            if parser.pdf_path.exists():
                parser.parse_pdf()
    else:
        logger.info("Rules PDF is up to date.")
        if not parser.json_path.exists():
            logger.info("JSON not found. Parsing existing PDF...")
            parser.parse_pdf()

    logger.info("PDF parser task complete.")


if __name__ == "__main__":
    main()
