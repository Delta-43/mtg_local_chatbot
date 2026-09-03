const WIDGET_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Scryfall card search</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #17202a;
        background: #f7f4ed;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 14px;
        background: #f7f4ed;
      }

      main {
        display: grid;
        gap: 12px;
      }

      header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: baseline;
      }

      h1 {
        margin: 0;
        font-size: 1rem;
        line-height: 1.2;
      }

      .summary {
        margin: 0;
        color: #52606d;
        font-size: 0.82rem;
        text-align: right;
      }

      form {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
      }

      input {
        width: 100%;
        min-width: 0;
        border: 1px solid #c8d0d9;
        border-radius: 8px;
        padding: 9px 10px;
        font: inherit;
        background: #ffffff;
        color: #17202a;
      }

      button {
        border: 0;
        border-radius: 8px;
        padding: 9px 12px;
        font: inherit;
        font-weight: 650;
        background: #1864ab;
        color: #ffffff;
        cursor: pointer;
      }

      button:disabled {
        opacity: 0.6;
        cursor: wait;
      }

      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(142px, 1fr));
        gap: 10px;
      }

      article {
        min-width: 0;
        border: 1px solid #d5d9df;
        border-radius: 8px;
        background: #ffffff;
        overflow: hidden;
      }

      article img {
        display: block;
        width: 100%;
        aspect-ratio: 488 / 680;
        object-fit: cover;
        background: #dde3ea;
      }

      .body {
        display: grid;
        gap: 5px;
        padding: 9px;
      }

      h2 {
        margin: 0;
        font-size: 0.9rem;
        line-height: 1.2;
        overflow-wrap: anywhere;
      }

      .type,
      .meta,
      .source,
      .empty {
        margin: 0;
        color: #52606d;
        font-size: 0.78rem;
        line-height: 1.35;
      }

      .meta {
        color: #7b3f00;
      }

      .source a {
        color: #1864ab;
      }

      @media (prefers-color-scheme: dark) {
        :root,
        body {
          color: #f3f6f8;
          background: #12161b;
        }

        input,
        article {
          color: #f3f6f8;
          background: #1c232b;
          border-color: #334150;
        }

        .summary,
        .type,
        .source,
        .empty {
          color: #aab5c0;
        }

        .meta {
          color: #f0b56b;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>Scryfall search</h1>
        <p class="summary" id="summary">Waiting for cards</p>
      </header>
      <form id="search-form">
        <input id="query" name="query" autocomplete="off" placeholder="name:otter color:u" />
        <button id="submit" type="submit">Search</button>
      </form>
      <section class="cards" id="cards" aria-live="polite"></section>
    </main>
    <script>
      const state = {
        query: "",
        totalCards: 0,
        cards: []
      };

      const cardsNode = document.getElementById("cards");
      const summaryNode = document.getElementById("summary");
      const queryInput = document.getElementById("query");
      const submitButton = document.getElementById("submit");

      function text(value) {
        return typeof value === "string" ? value : "";
      }

      function render() {
        queryInput.value = state.query || queryInput.value;
        summaryNode.textContent = state.totalCards > 0
          ? state.totalCards + " total match" + (state.totalCards === 1 ? "" : "es")
          : "No cards loaded";

        cardsNode.replaceChildren();
        if (!state.cards.length) {
          const empty = document.createElement("p");
          empty.className = "empty";
          empty.textContent = "No cards loaded.";
          cardsNode.append(empty);
          return;
        }

        for (const card of state.cards) {
          const article = document.createElement("article");
          if (card.imageUrl) {
            const image = document.createElement("img");
            image.src = card.imageUrl;
            image.alt = card.name || "Magic card";
            article.append(image);
          }

          const body = document.createElement("div");
          body.className = "body";
          const title = document.createElement("h2");
          title.textContent = text(card.name);
          const type = document.createElement("p");
          type.className = "type";
          type.textContent = text(card.typeLine);
          const meta = document.createElement("p");
          meta.className = "meta";
          meta.textContent = [card.manaCost, card.set, card.rarity].filter(Boolean).join(" / ");
          const source = document.createElement("p");
          source.className = "source";
          if (card.artist) {
            source.append(document.createTextNode("Art by " + text(card.artist) + " · "));
          }
          if (card.scryfallUrl) {
            const link = document.createElement("a");
            link.href = text(card.scryfallUrl);
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = "View on Scryfall";
            source.append(link);
          }
          body.append(title, type, meta, source);
          article.append(body);
          cardsNode.append(article);
        }
      }

      async function callSearch(query) {
        if (!window.openai?.callTool) return;
        submitButton.disabled = true;
        try {
          const result = await window.openai.callTool("show_card_search", { query, limit: 8 });
          applyToolResult(result);
        } finally {
          submitButton.disabled = false;
        }
      }

      function applyToolResult(toolResult) {
        const data = toolResult?.structuredContent || window.openai?.toolOutput || {};
        state.query = text(data.query);
        state.totalCards = Number.isFinite(data.totalCards) ? data.totalCards : 0;
        state.cards = Array.isArray(data.cards) ? data.cards : [];
        render();
      }

      window.addEventListener("message", (event) => {
        if (event.source !== window.parent) return;
        const message = event.data;
        if (!message || message.jsonrpc !== "2.0") return;
        if (message.method === "ui/notifications/tool-result") {
          applyToolResult(message.params);
        }
      }, { passive: true });

      document.getElementById("search-form").addEventListener("submit", (event) => {
        event.preventDefault();
        const query = queryInput.value.trim();
        if (query) void callSearch(query);
      });

      applyToolResult({ structuredContent: window.openai?.toolOutput });
    </script>
  </body>
</html>`;

export class CardSearchWidgetResource {
  readonly uri = "ui://widget/card-search.html";
  readonly name = "card-search-widget";
  readonly description = "Interactive ChatGPT widget for Scryfall card search results";
  readonly mimeType = "text/html;profile=mcp-app";
  readonly _meta = {
    "openai/widgetDescription": "Displays concise Scryfall card search results as a responsive card grid.",
    ui: {
      csp: {
        connectDomains: [],
        resourceDomains: ["https://cards.scryfall.io"],
      },
      prefersBorder: true,
    },
  };

  async getData(): Promise<string> {
    return WIDGET_HTML;
  }
}
