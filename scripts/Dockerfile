# ralph-wiggum sandbox environment
# Node 24 + Claude Code
#
# Build:
#   docker build -t ralph-wiggum -f scripts/Dockerfile .
#
# Run:
#   ./scripts/ralph-wiggum.sh "your prompt" tmp/output.md

FROM node:24-bookworm

# -----------------------------------------------------------------------------
# System dependencies
# -----------------------------------------------------------------------------

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    jq \
    sudo \
    tree \
    && rm -rf /var/lib/apt/lists/*

# -----------------------------------------------------------------------------
# Claude Code
# -----------------------------------------------------------------------------

RUN npm install -g @anthropic-ai/claude-code

# -----------------------------------------------------------------------------
# Non-root user (required for --dangerously-skip-permissions)
# Created at build time to match host user's UID/GID
# -----------------------------------------------------------------------------

ARG HOST_UID=1000
ARG HOST_GID=1000

RUN groupadd -g ${HOST_GID} ralph 2>/dev/null || true && \
    useradd -m -u ${HOST_UID} -g ${HOST_GID} -s /bin/bash ralph 2>/dev/null || \
    useradd -m -u ${HOST_UID} -o -g ${HOST_GID} -s /bin/bash ralph && \
    echo "ralph ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# -----------------------------------------------------------------------------
# Workspace setup
# -----------------------------------------------------------------------------

WORKDIR /workspace

USER ralph

CMD ["claude", "--help"]
