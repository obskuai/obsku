# Default: show available commands
default:
    @just --list

# Run all tests
test:
    bun test $(find packages -name '*.test.ts' ! -path '*code-interpreter-wasm*')

# Run WASM/Pyodide tests separately (event-loop blocking)
test-wasm:
    bun test packages/tools/code-interpreter-wasm

# Build all packages
build:
    bun run --filter '*' build

# TypeScript type checking
typecheck:
    bunx tsc --noEmit

# Run all checks (typecheck + test)
check: typecheck test

# Clean build artifacts
clean:
    rm -rf packages/*/dist tsconfig.tsbuildinfo

# Start vulnerable target lab
targets-up:
    docker-compose -f docker/docker-compose.yml up -d
    @echo "Waiting for targets..."
    @sleep 5
    @echo "Targets ready:"
    @echo "  DVWA:     http://localhost:8080"
    @echo "  Metasploitable: localhost:8081 (HTTP), :2222 (SSH), :2121 (FTP)"
    @echo "  Nginx:    http://localhost:8082"

# Stop vulnerable target lab
targets-down:
    docker-compose -f docker/docker-compose.yml down

# Status of target lab
targets-status:
    docker-compose -f docker/docker-compose.yml ps
