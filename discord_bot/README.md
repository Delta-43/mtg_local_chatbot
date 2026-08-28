# MTG Judge Discord Bot

A thin Discord client for the `mtg_local_chatbot` backend: a single `/judge`
slash command that calls the backend's `POST /chat` (non-streaming) and
replies with the answer. It does not import or run the agent itself — see the
root `CLAUDE.md`/`PLAN.md` for why (keeps this independently deployable, same
reasoning as `rules_mcp/`).

## Setup

```bash
pip install -r discord_bot/requirements.txt
cp discord_bot/bot_config.yml discord_bot/bot_config.local.yml  # optional, or just use env vars
export DISCORD_BOT_TOKEN=...      # from the Discord developer portal
export API_KEY=...                # a dedicated entry in the backend's API_KEYS list
export API_BASE_URL=http://localhost:8000
python -m discord_bot.bot
```

The bot's Discord application needs the `applications.commands` OAuth2 scope
and no privileged gateway intents (it never reads ordinary messages, only
slash-command interactions).

## Design notes

- **Slash-command only** (`/judge question:<...>`), not `on_message` — the bot
  never scans regular chat.
- **Non-streaming** `/chat` call, not `/chat/stream` — coalescing tokens into
  Discord message edits fights Discord's own edit rate limits; `defer()` +
  the interaction's "thinking" state already covers the wait.
- **Per-channel conversation memory**: `conversation_id = discord-channel-<id>`
  — everyone in a channel shares one running conversation with the judge,
  matching how this bot is actually used.
- **Per-user cooldown** (`bot_config.yml`'s `discord.cooldown_seconds`,
  default 10s) protects the backend's shared daily quota — the bot uses one
  API key for every call, so without this a single user could exhaust the
  whole server's quota alone.
- **Optional guild allowlist** (`discord.allowed_guild_ids`) restricts which
  servers the command is even registered in, to cap cost exposure.
- Answers over Discord's 2000-character limit are split across multiple
  messages (see `_chunk_message` in `bot.py`).

## Deployment

Not wired into the root `docker-compose.yml` yet — deferred alongside the
domain/TLS work, since this bot should point at the backend's eventual public
URL rather than an internal Docker service name (see `PLAN.md`).
