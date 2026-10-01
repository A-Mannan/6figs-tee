# membership-challenge Specification

## Purpose
Let a signer see exactly which wallets a signature authorizes so that phishing a signature cannot silently enroll the victim's wallet with an attacker.

## Requirements

### Requirement: Challenge lists the wallet set

The system SHALL include every wallet address of the authorized set, in sorted order, in the ownership challenge the wallets sign.

#### Scenario: Multi-wallet registration
- **WHEN** a challenge is built for a wallet set
- **THEN** the message body lists each member address and the enclave rejects signatures over any other message
