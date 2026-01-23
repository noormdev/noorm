#!/bin/bash
# ralph-wiggum.sh - Autonomous Claude Code runner with sandboxed Docker execution
#
# Usage:
#   ./scripts/ralph-wiggum.sh <prompt|prompt-file> [state-file] [max-iterations]
#   ./scripts/ralph-wiggum.sh --build                 # Rebuild Docker image
#   ./scripts/ralph-wiggum.sh --login                 # Login to Claude inside container
#   ./scripts/ralph-wiggum.sh --shell                 # Open bash in container (debugging)
#
# Examples:
#   ./scripts/ralph-wiggum.sh "Fix all TypeScript errors" tmp/fix-ts.md
#   ./scripts/ralph-wiggum.sh prompts/elaborate-task.md tmp/task-state.md 20
#
# First-time setup:
#   1. ./scripts/ralph-wiggum.sh --build    # Build image with your UID
#   2. ./scripts/ralph-wiggum.sh --login    # Authenticate Claude in container
#
# The script will loop until:
#   - Claude outputs <promise>DONE</promise> in the state file
#   - OR max iterations is reached

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_NAME="$(basename "$PROJECT_DIR")"
IMAGE_NAME="ralph-wiggum:$REPO_NAME"

# -----------------------------------------------------------------------------
# Docker Image Management
# -----------------------------------------------------------------------------

build_image() {
    echo "Building Docker image: $IMAGE_NAME (UID=$(id -u), GID=$(id -g))"
    docker build \
        --build-arg HOST_UID="$(id -u)" \
        --build-arg HOST_GID="$(id -g)" \
        -t "$IMAGE_NAME" \
        -f "$SCRIPT_DIR/Dockerfile" \
        "$PROJECT_DIR"
}

ensure_image() {
    if ! docker image inspect "$IMAGE_NAME" &>/dev/null; then
        echo "Image '$IMAGE_NAME' not found. Building..."
        build_image
    fi
}

# Handle --build flag
if [[ "$1" == "--build" ]]; then
    build_image
    exit 0
fi

# Handle --login flag
if [[ "$1" == "--login" ]]; then
    ensure_image
    echo "Logging into Claude Code inside container..."
    docker run -it --rm \
        -v "$HOME/.claude":/home/ralph/.claude \
        "$IMAGE_NAME" \
        claude /login
    exit 0
fi

# Handle --shell flag (for debugging)
if [[ "$1" == "--shell" ]]; then
    ensure_image
    echo "Opening shell in container..."
    docker run -it --rm \
        -v "$(pwd)":/workspace \
        -v "$HOME/.claude":/home/ralph/.claude \
        -w /workspace \
        "$IMAGE_NAME" \
        bash
    exit 0
fi

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

PROMPT_OR_FILE="$1"
STATE_FILE="${2:-tmp/ralph-state.md}"
MAX_ITERATIONS="${3:-20}"
LOG_FILE="${STATE_FILE%.md}.log"
ITERATION=1

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------

log() {
    local level="$1"
    shift
    local msg="$*"
    local timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
    echo "[$timestamp] [$level] $msg" | tee -a "$LOG_FILE"
}

log_info()  { log "INFO" "$@"; }
log_error() { log "ERROR" "$@"; }
log_warn()  { log "WARN" "$@"; }

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------

if [[ -z "$PROMPT_OR_FILE" ]]; then
    echo "Usage: $0 <prompt|prompt-file> [state-file] [max-iterations]"
    echo ""
    echo "Options:"
    echo "  --build    Rebuild the Docker image"
    echo "  --login    Login to Claude inside container"
    echo "  --shell    Open bash in container (debugging)"
    echo ""
    echo "Examples:"
    echo "  $0 \"Fix all TypeScript errors\" tmp/fix-ts.md"
    echo "  $0 prompts/task.md tmp/state.md 50"
    exit 1
fi

# Ensure output directories exist
mkdir -p "$(dirname "$STATE_FILE")"
mkdir -p "$(dirname "$LOG_FILE")"

# Initialize log
echo "" > "$LOG_FILE"
log_info "=== Ralph Wiggum Autonomous Runner ==="
log_info "State file: $STATE_FILE"
log_info "Max iterations: $MAX_ITERATIONS"

# -----------------------------------------------------------------------------
# Prompt Loading
# -----------------------------------------------------------------------------

if [[ -f "$PROMPT_OR_FILE" ]]; then
    PROMPT="$(cat "$PROMPT_OR_FILE")"
    log_info "Loaded prompt from file: $PROMPT_OR_FILE"
    log_info "Prompt length: ${#PROMPT} characters"
else
    PROMPT="$PROMPT_OR_FILE"
    log_info "Using inline prompt (${#PROMPT} characters)"
fi

# -----------------------------------------------------------------------------
# State File Bootstrap
# -----------------------------------------------------------------------------

bootstrap_state_file() {
    if [[ ! -f "$STATE_FILE" ]] || [[ ! -s "$STATE_FILE" ]]; then
        log_info "Bootstrapping state file: $STATE_FILE"
        cat > "$STATE_FILE" << 'EOF'
## Progress

- [ ] (starting task...)

## Current Status

Initializing...

## Notes

(none yet)
EOF
    else
        log_info "Resuming from existing state file"
    fi
}

# -----------------------------------------------------------------------------
# Prompt File Creation (with state injection + double prompt)
# -----------------------------------------------------------------------------

create_prompt_file() {
    local prompt_file="$1"

    cat > "$prompt_file" << EOF
# Current State

@$STATE_FILE

---

# Task

$PROMPT

---

# Task (repeated for emphasis)

$PROMPT

---

# Instructions

You are in an autonomous loop. After completing significant work:

1. UPDATE the state file at \`$STATE_FILE\` with your progress:
   - Check off completed items in ## Progress
   - Update ## Current Status with what you're working on
   - Add any ## Notes about decisions or blockers

2. When the task is FULLY COMPLETE:
   - Ensure all progress items are checked
   - Add \`<promise>DONE</promise>\` at the end of the state file

3. If you encounter blockers you cannot resolve:
   - Document them in ## Notes
   - Add \`<promise>BLOCKED</promise>\` at the end of the state file

IMPORTANT: Update the state file DURING your work, not just at the end.
The state file is your memory between iterations.
EOF
}

# -----------------------------------------------------------------------------
# Completion Detection
# -----------------------------------------------------------------------------

check_completion() {
    if [[ ! -f "$STATE_FILE" ]]; then
        return 1
    fi

    # Check for completion promise
    if grep -q '<promise>DONE</promise>' "$STATE_FILE"; then
        log_info "Completion promise found: DONE"
        return 0
    fi

    # Check for blocked state
    if grep -q '<promise>BLOCKED</promise>' "$STATE_FILE"; then
        log_warn "Task is BLOCKED - stopping loop"
        return 0
    fi

    return 1
}

# -----------------------------------------------------------------------------
# Cleanup handler
# -----------------------------------------------------------------------------

PROMPT_FILE=""

cleanup() {
    local exit_code=$?
    if [[ -n "$PROMPT_FILE" ]] && [[ -f "$PROMPT_FILE" ]]; then
        rm -f "$PROMPT_FILE"
    fi
    if [[ $exit_code -eq 0 ]]; then
        log_info "=== Completed ==="
    else
        log_error "=== Exited with code: $exit_code ==="
    fi
}
trap cleanup EXIT

# -----------------------------------------------------------------------------
# Main Loop
# -----------------------------------------------------------------------------

ensure_image
bootstrap_state_file

log_info "Starting autonomous loop..."
log_info "Image: $IMAGE_NAME"
log_info "Mounting workspace: $PROJECT_DIR"
log_info "Mounting Claude config: $HOME/.claude"

while [[ $ITERATION -le $MAX_ITERATIONS ]]; do
    log_info "--- Iteration $ITERATION of $MAX_ITERATIONS ---"

    # Create prompt file with current state
    PROMPT_FILE="$(mktemp)"
    create_prompt_file "$PROMPT_FILE"

    # Run Claude Code in Docker
    docker run -t --rm \
        -v "$PROJECT_DIR":/workspace \
        -v "$HOME/.claude":/home/ralph/.claude \
        -v "$PROMPT_FILE":/tmp/prompt.txt:ro \
        -w /workspace \
        "$IMAGE_NAME" \
        claude -p "$(cat "$PROMPT_FILE")" \
            --dangerously-skip-permissions \
            --verbose \
            --output-format text \
            --max-turns 50 \
        2>&1 | tee -a "$LOG_FILE"

    # Cleanup prompt file
    rm -f "$PROMPT_FILE"
    PROMPT_FILE=""

    # Check for completion
    if check_completion; then
        log_info "Task completed after $ITERATION iteration(s)"
        break
    fi

    # Increment iteration
    ITERATION=$((ITERATION + 1))

    if [[ $ITERATION -gt $MAX_ITERATIONS ]]; then
        log_warn "Max iterations ($MAX_ITERATIONS) reached without completion"
        break
    fi

    log_info "Continuing to next iteration..."
    sleep 2  # Brief pause between iterations
done

log_info "Final state saved to: $STATE_FILE"
log_info "Full log available at: $LOG_FILE"
