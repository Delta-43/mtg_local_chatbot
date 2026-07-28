# %%
# Magic: The Gathering Rules PDF Parser
# This script parses the Magic: The Gathering Comprehensive Rules PDF and organizes the rules into a hierarchical structure.
import re
import os
os.chdir(r"G:\MTG_Bot_Project")
import json
from pdfminer.high_level import extract_text
from pdfminer.layout import LAParams

# %%
# PDF setup
pdf_path = "MagicCompRules TestPage.pdf"
laparams = LAParams(line_overlap=0.5, char_margin=2.0, line_margin=0.5, word_margin=0.1)
text = extract_text(pdf_path, laparams=laparams)

# Structure Pattern Regex
chapter_pattern = re.compile(r'^(\d{1})\.\s+(.+)$', re.MULTILINE)
section_pattern = re.compile(r'^(\d{3})\.\s+(.+)$', re.MULTILINE)
rule_pattern = re.compile(r'^(\d{3}\.\d+)\.\s+(.+)$', re.MULTILINE)
subrule_pattern = re.compile(r'^(\d{3}\.\d+[a-z])\.?\s+(.+)$', re.MULTILINE)

# %%

def merge_pdf_lines(lines):
    merged = []
    buffer = ""
    for line in lines:
        line = line.strip()
        if not line:
            continue
        # If line starts with a heading/section/rule, flush buffer
        if chapter_pattern.match(line) or section_pattern.match(line) or rule_pattern.match(line) or subrule_pattern.match(line):
            if buffer:
                merged.append(buffer)
                buffer = ""
            buffer = line
        else:
            if buffer:
                buffer += " " + line
            else:
                buffer = line
    if buffer:
        merged.append(buffer)
    return merged

clean_text = merge_pdf_lines(text.splitlines())

# %%

# Hierarchy containers
hierarchy = []
current_chapter = None
current_section = None
current_rule = None
current_rule_id = None
rule_text = []
subrule_buffer = []

# Line-by-line parsing
for line in clean_text:
    line = line.strip()
    if not line:
        continue
    chapter_match = chapter_pattern.match(line)
    section_match = section_pattern.match(line)
    rule_match = rule_pattern.match(line)
    subrule_match = subrule_pattern.match(line)

    if chapter_match:
        # Save previous buffered chapter
        if current_rule_id and rule_text and current_section:
            current_section["rules"].append({
                "rule_id": current_rule_id,
                "text": " ".join(rule_text).strip(),
                "subrules": " ".join(subrule_buffer).strip() if subrule_buffer else ""
            })
        if current_chapter:
            current_chapter["sections"].append(current_section)
            hierarchy.append(current_chapter)

        current_chapter = {
            "heading": line,
            "sections": []
        }
        current_section = None
        current_rule_id = None
        rule_text = []

    elif section_match:
        if current_rule_id and rule_text and current_section:
            current_section["rules"].append({
                "rule_id": current_rule_id,
                "text": " ".join(rule_text).strip(),
                "subrules": " ".join(subrule_buffer).strip() if subrule_buffer else ""
            })
        if current_chapter:
            current_chapter["sections"].append(current_section)
        
        current_section = {
            "section_id": section_match.group(1),
            "section_title": section_match.group(2),
            "rules": []
        }
        current_rule_id = None
        rule_text = []

    elif rule_match:
        if current_rule_id and rule_text and current_section:
            current_section["rules"].append({
                "rule_id": current_rule_id,
                "text": " ".join(rule_text).strip(),
                "subrules": " ".join(subrule_buffer).strip() if subrule_buffer else ""
            })
        current_rule_id = rule_match.group(1)
        rule_text = rule_match.group(2).strip()
        subrule_buffer = []

    elif subrule_match:
        # Subrules are treated as part of the current rule
        if current_rule_id and subrule_buffer:
            subrule_id = subrule_match.group(1)
            subrule_text = subrule_match.group(2).strip()
            subrule_buffer.append(f"{subrule_id} {subrule_text}")

# Final rule flush
if current_rule_id and rule_text and current_section:
    current_section["rules"].append({
        "rule_id": current_rule_id,
        "text": " ".join(rule_text).strip(),
        "subrules": " ".join(subrule_buffer).strip() if subrule_buffer else ""
    })
if current_chapter:
    current_chapter["sections"].append(current_section)

hierarchy.append(current_chapter) if current_chapter else None

# Save to JSON
with open("parsed_rules_hierarchical.json", "w", encoding="utf-8") as f:
    json.dump(hierarchy, f, ensure_ascii=False, indent=2)


print("Hello World")

