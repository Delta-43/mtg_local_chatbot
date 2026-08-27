FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app_api/ ./app_api/
COPY core_config/ ./core_config/
COPY llm_agent/ ./llm_agent/
COPY scryfall_agent/ ./scryfall_agent/
COPY scripts/ ./scripts/
COPY project_config.yml ./project_config.yml

RUN chmod +x /app/scripts/docker_entrypoint.sh

EXPOSE 8000

CMD ["/app/scripts/docker_entrypoint.sh"]
