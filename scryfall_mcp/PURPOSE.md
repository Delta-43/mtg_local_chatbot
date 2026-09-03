# Purpose

This project exists to make Scryfall's Magic: The Gathering data usable through the Model Context Protocol so AI assistants can answer card, rules, pricing, set, and deckbuilding questions with structured tool access instead of unreliable freeform guessing.

## Problem It Tries To Solve

Large language models are not dependable sources for precise, current MTG card data. They frequently hallucinate oracle text, prices, legality, and set details, and they are not well suited to translating fuzzy deckbuilding requests into efficient Scryfall queries on their own. This server reduces that gap by exposing targeted MCP tools and resources backed by Scryfall and local rules data.

## Primary Concerns

- Accuracy: return real Scryfall-backed data rather than model guesses
- Compliance: respect Scryfall rate limits, caching expectations, and attribution requirements
- Reliability: provide predictable error handling, validation, and bounded resource usage
- Practicality: support the questions MTG players actually ask, especially discovery, comparison, and deckbuilding
- Maintainability: keep the MCP surface understandable for both contributors and client integrators
