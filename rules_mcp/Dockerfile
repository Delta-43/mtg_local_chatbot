FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./rules_mcp/

RUN mkdir -p /app/data/chroma /app/data/pdf_parser

EXPOSE 8100

CMD ["python", "-m", "rules_mcp.server"]
