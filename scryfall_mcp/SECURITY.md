# Security Policy

## Supported Scope

This project is intended to safely expose Scryfall-backed data and MTG helper workflows through MCP. Security-sensitive areas include:

- request validation and sanitization
- outbound HTTP behavior and rate limiting
- cache bounds and memory usage
- environment-variable handling
- dependency hygiene

## Reporting

Please do not include vulnerability details, reproduction steps, or proof-of-concept material in a public issue.

Use GitHub private vulnerability reporting when it is enabled for this repository. If that option is unavailable, open a minimal public issue asking the maintainer to establish a private reporting channel, without identifying the suspected component or including technical details.

## What To Include

- a clear description of the issue
- affected files, functions, or tools
- reproduction steps or proof of concept
- impact assessment
- suggested remediation, if known

## Disclosure

Please allow time to validate and remediate the issue before public disclosure. Coordinated disclosure is preferred.
