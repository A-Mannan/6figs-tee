# Spec Delta

## Purpose

Guarantee that concurrent registrations for the same account serialize into one coherent state instead of interleaving reads and writes.

## ADDED Requirements

### Requirement: Atomic registration persistence

The system SHALL execute the read-check-mutate sequence of a registration inside a single transactional boundary provided by the store.

#### Scenario: Concurrent transitions
- **WHEN** two registrations for the same account arrive concurrently
- **THEN** they serialize and the final bindings equal the outcome of one complete transition followed by the other, with no orphaned rows
