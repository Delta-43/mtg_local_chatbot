# %%
# Magic: The Gathering Rules PDF Parser (Refactored)
import re
import os
import json
from pdfminer.high_level import extract_text
from pdfminer.layout import LAParams
from pdfminer.pdfpage import PDFPage

# Set working directory
os.chdir(r"G:\MTG_Bot_Project")

# %%
# PDF setup
# Test Page: "MagicCompRules TestPage.pdf"
pdf_path = "MagicCompRules TestPage.pdf"
# Production PDF: "MagicCompRules 20250606.pdf"
# pdf_path = "MagicCompRules 20250606.pdf"
laparams = LAParams(line_overlap=0.5, char_margin=2.0, line_margin=0.5, word_margin=0.1)
# Index pages to extract text (ignore Content and Intro pages)
with open(pdf_path, "rb") as f:
    total_pages = sum(1 for _ in PDFPage.get_pages(f))
page_indices = list(range(4, total_pages))

#text = extract_text(pdf_path, page_numbers=page_indices, laparams=laparams)
text = extract_text(pdf_path, laparams=laparams)

# %%
# Regex patterns
chapter_pattern = re.compile(r'^(\d{1})\.\s+(.+)$', re.MULTILINE)
section_pattern = re.compile(r'^(\d{3})\.\s+(.+)$', re.MULTILINE)
rule_pattern = re.compile(r'^(\d{3}\.\d+)\.\s+(.+)$', re.MULTILINE)
subrule_pattern = re.compile(r'^(\d{3}\.\d+[a-z])\.?\s+(.+)$', re.MULTILINE)

# %%
# Merge broken lines
def merge_pdf_lines(lines):
    merged = []
    buffer = ""
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if chapter_pattern.match(line) or section_pattern.match(line) or rule_pattern.match(line) or subrule_pattern.match(line):
            if buffer:
                merged.append(buffer)
                buffer = ""
            buffer = line
        else:
            buffer += " " + line
    if buffer:
        merged.append(buffer)
    return merged

clean_text = merge_pdf_lines(text.splitlines())

def is_valid_heading(line):
    # Must end with a letter or punctuation, not just a number
    return bool(re.match(r'^\d{3}\.\s.*[a-zA-Z\)\."!]$', line.strip()))

def ends_with_terminal(text):
    return text.strip()[-1:] in {'.', ')', '"'}

def flush_rule():
    if current_rule_id and rule_text:
        full_text = ' '.join(rule_text).strip()
        if ends_with_terminal(full_text):
            current_section["rules"].append({
                "rule_id": current_rule_id,
                "text": full_text,
                "subrules": subrule_buffer
            })
        else:
            # Treat as continuation or log warning
            rule_text.append("(incomplete rule?)")

# %%
# Hierarchy containers
hierarchy = []
current_chapter = None
current_section = None
current_rule_id = None
rule_text = []
subrule_buffer = []

# Flush helpers
def flush_rule():
    global current_rule_id, rule_text, subrule_buffer, current_section
    if current_rule_id and rule_text:
        check_text = ' '.join(rule_text).strip()
    if ends_with_terminal(check_text):
        if current_rule_id and rule_text and current_section:
            current_section["rules"].append({
                "rule_id": current_rule_id,
                "text": " ".join(rule_text).strip(),
                "subrules": subrule_buffer if subrule_buffer else []
            })
    else:
        # Treat as continuation or log warning
        print("Warning: Odd rule ending detected - ", check_text)
        
    current_rule_id = None
    rule_text = []
    subrule_buffer = []

def flush_section():
    global current_section, current_chapter
    if current_section and current_chapter:
        current_chapter["sections"].append(current_section)
    current_section = None

def flush_chapter():
    global current_chapter
    if current_chapter:
        hierarchy.append(current_chapter)
    current_chapter = None

# %%
# Line-by-line parsing
for line in clean_text:
    line = line.strip()
    if not line:
        continue

    subrule_match = subrule_pattern.match(line)
    rule_match = rule_pattern.match(line)
    section_match = section_pattern.match(line)
    chapter_match = chapter_pattern.match(line)

    if chapter_match and is_valid_heading(line):
        flush_rule()
        flush_section()
        flush_chapter()
        current_chapter = {
            "heading": line,
            "sections": []
        }

    elif section_match and is_valid_heading(line):
        flush_rule()
        flush_section()
        current_section = {
            "section_id": section_match.group(1),
            "section_title": section_match.group(2),
            "rules": []
        }

    elif rule_match:
        flush_rule()
        current_rule_id = rule_match.group(1)
        rule_text = [rule_match.group(2).strip()]
        subrule_buffer = []

    elif subrule_match:
        subrule_buffer.append({
            "subrule_id": subrule_match.group(1),
            "text": subrule_match.group(2).strip()
        })

    else:
        # Continuation of rule or subrule text
        if current_rule_id:
            rule_text.append(line)

# Final flush
flush_rule()
flush_section()
flush_chapter()

# %%
# Save to JSON
with open("MagicCompRule_parsed_hierarchical.json", "w", encoding="utf-8") as f:
    json.dump(hierarchy, f, ensure_ascii=False, indent=2)

print("Parsing complete.")
