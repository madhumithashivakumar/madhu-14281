# TierTracker Project Directives: S-Tier Engineering

This project strictly adheres to the **S-Tier Engineering & Software Craftsmanship Protocol**.

## Core Engineering Rules
1. **Hexagonal Architecture (Ports & Adapters):**
   - Core domain models and business logic (spatial raycasting, occupancy aggregation, session lifecycle) MUST have zero external dependencies.
   - All I/O, database access, external SDKs, and HTTP transport layers must sit behind Port interfaces as Adapters.
2. **Defensive Craftsmanship:**
   - Strict typing and explicit domain errors / Result types.
   - Zero placeholder slop: No `// TODO`, `/* implement later */`, or stubbed mocks.
   - Hermetic testability: Business logic must be 100% testable in-memory without live networks or databases.
3. **Resilience & Fault Isolation:**
   - Explicit timeouts, bounded memory buffers with sliding-window TTL eviction, and sanitization on all geospatial inputs.
