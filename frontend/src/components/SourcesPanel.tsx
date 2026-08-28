import type { Sources } from "../types";

export function SourcesPanel({ sources }: { sources: Sources }) {
  const hasAny =
    sources.rules.length ||
    sources.rulings.length ||
    sources.web_links.length ||
    sources.images.length;
  if (!hasAny) return null;

  return (
    <details className="sources-panel">
      <summary>Sources</summary>
      {sources.images.length > 0 && (
        <div className="sources-group sources-images">
          {sources.images.map((url) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
              <img src={url} alt="Card" loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {sources.rules.length > 0 && (
        <div className="sources-group">
          <strong>Rules</strong>
          <ul>
            {sources.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {sources.rulings.length > 0 && (
        <div className="sources-group">
          <strong>Rulings</strong>
          <ul>
            {sources.rulings.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {sources.web_links.length > 0 && (
        <div className="sources-group">
          <strong>Web</strong>
          <ul>
            {sources.web_links.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}
