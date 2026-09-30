# Spec Delta

## Purpose

Let an account survive the loss of one wallet without letting a stolen subset take it over silently.

## ADDED Requirements

### Requirement: Threshold transitions with cooldown

The system SHALL accept a membership transition signed by N−1 of N enrolled wallets only after a cooldown, and SHALL record the pending transition where the remaining wallet can observe it.

#### Scenario: Lost wallet recovery
- **WHEN** N−1 wallets sign a transition removing the lost wallet and the cooldown elapses uncontested
- **THEN** the transition applies

#### Scenario: Contested transition
- **WHEN** the remaining wallet signs a conflicting statement during cooldown
- **THEN** the pending transition is cancelled
