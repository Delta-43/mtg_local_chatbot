"""Thin Discord client for the MTG Judge backend. Slash-command only (no
on_message scanning) -- explicit invocation is easier to rate-limit/scope and
means the bot never processes ordinary chat content it doesn't own."""

import logging

import discord
from discord import app_commands

from .api_client import ChatApiError, chat
from .settings import Settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DISCORD_MESSAGE_LIMIT = 2000
_CHUNK_SIZE = 1900  # headroom under Discord's 2000-char limit


def _conversation_id_for(channel_id: int) -> str:
    # Per-channel continuity: multiple people in one channel share a running
    # conversation, matching how a shared judge bot actually gets used
    # (confirmed choice -- see PLAN.md's Discord section).
    return f"discord-channel-{channel_id}"


def _format_sources(sources: dict) -> str:
    lines = []
    if sources.get("rules"):
        lines.append("**Rules:** " + ", ".join(sources["rules"]))
    if sources.get("rulings"):
        lines.append("**Rulings:** " + ", ".join(sources["rulings"]))
    if sources.get("web_links"):
        lines.append("**Web:** " + ", ".join(sources["web_links"]))
    return "\n".join(lines)


def _chunk_message(text: str) -> list[str]:
    if len(text) <= _CHUNK_SIZE:
        return [text]
    chunks = []
    while text:
        chunks.append(text[:_CHUNK_SIZE])
        text = text[_CHUNK_SIZE:]
    return chunks


def _guild_allowed(interaction: discord.Interaction) -> bool:
    if not Settings.ALLOWED_GUILD_IDS:
        return True
    return interaction.guild is not None and interaction.guild.id in Settings.ALLOWED_GUILD_IDS


class JudgeBot(discord.Client):
    def __init__(self):
        super().__init__(intents=discord.Intents.default())
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        if Settings.ALLOWED_GUILD_IDS:
            for guild_id in Settings.ALLOWED_GUILD_IDS:
                guild = discord.Object(id=guild_id)
                self.tree.copy_global_to(guild=guild)
                await self.tree.sync(guild=guild)
        else:
            await self.tree.sync()


client = JudgeBot()


@client.event
async def on_ready():
    logger.info("Logged in as %s", client.user)


@client.tree.command(name="judge", description="Ask the MTG rules judge a question")
@app_commands.describe(question="Your Magic: The Gathering rules or card question")
@app_commands.checks.cooldown(rate=1, per=Settings.COOLDOWN_SECONDS, key=lambda i: i.user.id)
async def judge(interaction: discord.Interaction, question: str):
    if not _guild_allowed(interaction):
        await interaction.response.send_message(
            "This bot isn't enabled in this server.", ephemeral=True
        )
        return

    await interaction.response.defer(thinking=True)
    conversation_id = _conversation_id_for(interaction.channel_id)

    try:
        result = await chat(question, conversation_id)
    except ChatApiError as exc:
        await interaction.followup.send(f"Sorry, I ran into a problem: {exc}")
        return

    answer = result.get("answer", "")
    sources_text = _format_sources(result.get("sources", {}))
    full_text = answer + (f"\n\n{sources_text}" if sources_text else "")

    chunks = _chunk_message(full_text)
    await interaction.followup.send(chunks[0])
    for chunk in chunks[1:]:
        await interaction.channel.send(chunk)


@judge.error
async def judge_error(interaction: discord.Interaction, error: app_commands.AppCommandError):
    if isinstance(error, app_commands.CommandOnCooldown):
        await interaction.response.send_message(
            f"Slow down a bit -- try again in {error.retry_after:.0f}s.", ephemeral=True
        )
        return
    logger.exception("Unhandled error in /judge", exc_info=error)
    message = "Something went wrong handling that command."
    if interaction.response.is_done():
        await interaction.followup.send(message, ephemeral=True)
    else:
        await interaction.response.send_message(message, ephemeral=True)


def main():
    if not Settings.DISCORD_BOT_TOKEN:
        raise SystemExit("DISCORD_BOT_TOKEN is not set (env var or bot_config.yml).")
    client.run(Settings.DISCORD_BOT_TOKEN)


if __name__ == "__main__":
    main()
