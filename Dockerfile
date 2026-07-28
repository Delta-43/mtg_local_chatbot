FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY config.py .
COPY main.py .
COPY pdf_parser/ ./pdf_parser/
COPY local_llm/ ./local_llm/
COPY scryfall_agent/ ./scryfall_agent/

RUN mkdir -p /app/data/chroma /app/data/pdf_parser

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
