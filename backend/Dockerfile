FROM ghcr.io/astral-sh/uv:0.12.7 AS uv
FROM python:3.13.14-slim AS base
COPY --from=uv /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 LANGGRAPH_STRICT_MSGPACK=true
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev
ENV REMBG_HOME=/opt/rembg OMP_NUM_THREADS=2
RUN python -c "from rembg import new_session; new_session('u2netp', providers=['CPUExecutionProvider'])"
COPY app ./app
COPY alembic.ini ./
COPY migrations ./migrations
RUN chmod -R a+rX /opt/rembg && useradd --uid 10001 --create-home wardrobe && mkdir -p /data/media && chown wardrobe /data/media
USER wardrobe
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM base AS test
USER root
RUN uv sync --locked
COPY tests ./tests
USER wardrobe
CMD ["pytest", "-q", "-p", "no:cacheprovider"]
