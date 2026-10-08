# Spec Delta

## REMOVED Requirements

### Requirement: Email signup and login

**Reason**: Email authentication is removed by product direction; accounts are
born from a wallet proof only.
**Migration**: Sign up and sign in by proving a wallet through the enclave, and
optionally set a username + password in the profile for device-free sign-in.

### Requirement: Wallets link to the logged-in account

**Reason**: There is no email account to link wallets to; the account is the
wallet set itself.
**Migration**: The first proven wallet creates or resolves the account; later
wallets are added through the signed addition transition.

### Requirement: Legacy wallet login coexists during migration

**Reason**: The legacy address-hash wallet login is removed together with the
`Wallet` table.
**Migration**: Wallet authentication resolves through attested nullifier
bindings under `wallet-first-auth`.

### Requirement: Login needs no stored address

**Reason**: Superseded by the stronger invariant that no address-derived value
reaches the backend at all.
**Migration**: See `wallet-first-auth` "No address reaches the backend" and the
modified `address-retirement` requirement.