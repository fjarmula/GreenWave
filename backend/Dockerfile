FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /workspace

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv

COPY pyproject.toml uv.lock ./
RUN uv sync --locked --all-groups --no-install-project

COPY . .
RUN uv sync --locked --all-groups
