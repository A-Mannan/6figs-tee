# Spec Delta

## Purpose

Give kept wallets a compact removal consent that names exactly what is being
removed and from which account.

## ADDED Requirements

### Requirement: Threshold removal challenge

The system SHALL present every kept wallet the same compact challenge binding
the account's identity pseudonym, the removed wallet address(es), the request
nonce, and the issue time, without listing the kept wallets or requiring the
removed wallet's signature.

#### Scenario: Removing a wallet
- **WHEN** a removal is prepared
- **THEN** each kept wallet signs a message naming the account pseudonym and the removed wallet(s)

#### Scenario: Challenge reuse
- **WHEN** a removal signature is presented for another nonce, timestamp, account, or removed set
- **THEN** the enclave rejects it