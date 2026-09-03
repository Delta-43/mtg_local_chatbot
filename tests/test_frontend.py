from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from httpx import Response

from app_api.main import app


@pytest.fixture
def client() -> TestClient:
    """Yields a TestClient instance for issuing requests against the FastAPI app.

    Allows fast, isolated HTTP unit tests against routing, middleware, and status codes
    without requiring external network calls or manual server lifecycles.
    """
    return TestClient(app)


def test_serve_index_endpoint_success(client: TestClient) -> None:
    """Verifies that GET / serves the developer test interface with cache-busting headers.

    Preventing browser caching via 'no-cache, must-revalidate' guarantees developers and automated
    harnesses always test against the latest offline assets rather than stale cached copies.
    Validates essential DOM elements required for interactive MTG rules queries.
    """
    response: Response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers.get("content-type", "")
    assert response.headers.get("cache-control") == "no-cache, must-revalidate"

    html: str = response.text
    assert "<!DOCTYPE html>" in html
    assert "MTG Rules Judge" in html
    assert "status-badge" in html
    assert "chat-container" in html
    assert "chat-input" in html
    assert "send-btn" in html
    assert "What happens during the untap step?" in html


def test_serve_index_missing_file(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensures GET / fails gracefully with HTTP 404 if index.html is missing on the filesystem.

    Protects against unhandled file read exceptions and gives developers an actionable error
    message if the static frontend file was deleted or improperly deployed in headless environments.
    """
    non_existent_file: Path = tmp_path / "missing_index.html"
    monkeypatch.setattr("app_api.main.INDEX_FILE", non_existent_file)

    response: Response = client.get("/")
    assert response.status_code == 404
    assert response.json().get("detail") == "Frontend test UI not found"


def test_static_asset_serving(client: TestClient) -> None:
    """Ensures static assets mounted under /static can be directly fetched by the browser.

    Mounting StaticFiles allows auxiliary assets such as icons, style sheets, or standalone
    scripts to be resolved deterministically without routing through custom application handlers.
    """
    response: Response = client.get("/static/index.html")
    assert response.status_code == 200
    assert "text/html" in response.headers.get("content-type", "")

    missing_response: Response = client.get("/static/non_existent_asset.xyz")
    assert missing_response.status_code == 404


def test_health_endpoint_schema_and_regression(client: TestClient) -> None:
    """Verifies that GET /health remains backwards-compatible and reports required service metrics.

    Orchestration tools, Caddy reverse proxies, and the frontend status indicator rely on this
    contract to determine whether backend MCP rules and Scryfall services are healthy.
    """
    response: Response = client.get("/health")
    assert response.status_code == 200
    data: dict[str, object] = response.json()
    assert data.get("status") == "healthy"
    assert "provider" in data
    assert "ready" in data
    assert "mcp_servers" in data

    mcp_servers: object = data.get("mcp_servers")
    assert isinstance(mcp_servers, dict)
    assert "rules_mcp" in mcp_servers
    assert "scryfall_mcp" in mcp_servers


def test_chat_rejects_empty_and_whitespace_queries(client: TestClient) -> None:
    """Verifies that POST /chat guards the backend by rejecting empty and whitespace-only queries.

    Prevents wasting expensive LLM inference tokens or invoking upstream tool graphs when
    the user or automated client submits blank inputs.
    """
    empty_response: Response = client.post("/chat", json={"query": ""})
    assert empty_response.status_code == 400
    assert empty_response.json().get("detail") == "Query cannot be empty"

    whitespace_response: Response = client.post("/chat", json={"query": "   \n\t  "})
    assert whitespace_response.status_code == 400
    assert whitespace_response.json().get("detail") == "Query cannot be empty"
