# Spec Delta

## REMOVED Requirements

### Requirement: Mailer delivery abstraction

**Reason**: No account email exists, so the mailer service and its production
boot gate are removed.
**Migration**: None; recovery is a wallet proof, not a message.

### Requirement: Signup email verification

**Reason**: Signup no longer collects an email or issues verification tokens.
**Migration**: Account control is established by the wallet proof at signup.

### Requirement: Forgot-password reset

**Reason**: A forgotten password is reset by proving an enrolled wallet, not by
an emailed link.
**Migration**: Use the wallet identify flow and consume its recovery token to
set a new password.

### Requirement: Authenticated password change

**Reason**: Behavior retained under a new capability; email accounts no longer
exist.
**Migration**: See `wallet-first-auth` "Optional username and password".

### Requirement: Password change invalidates old sessions

**Reason**: Behavior retained under a new capability.
**Migration**: See `wallet-first-auth` "Optional username and password".

### Requirement: Token storage is one-way

**Reason**: Emailed verification and reset tokens are removed; recovery tokens
are short-lived single-use cache entries, not stored account tokens.
**Migration**: None.

### Requirement: Resend delivery takes precedence

**Reason**: Removed with the mailer and email recovery flows.
**Migration**: None.