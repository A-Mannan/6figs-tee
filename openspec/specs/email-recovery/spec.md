# email-recovery Specification

## Purpose
Give email accounts a working recovery path: verify the address, reset a
forgotten password through a single-use link, and rotate a known password
without leaving old sessions alive.

## Requirements

### Requirement: Mailer delivery abstraction

The system SHALL send mail through a mailer service that uses SMTP when
configured and a console transport in development, and SHALL refuse to boot in
production without SMTP unless the documented console-mailer override is set.

#### Scenario: Dev delivery
- **WHEN** SMTP is not configured in development
- **THEN** the verification or reset link is logged for the developer instead of being sent

#### Scenario: Production without SMTP
- **WHEN** the backend boots in production with no SMTP configuration
- **THEN** it fails closed rather than silently dropping account email

### Requirement: Signup email verification

The system SHALL issue a single-use, expiring verification token on signup,
email a link carrying it, store only its hash, and mark the account verified
when the token is consumed; login SHALL remain possible but SHALL report the
unverified state.

#### Scenario: Verify a new account
- **WHEN** a user opens the emailed verification link
- **THEN** the token is consumed once and the account is marked verified

#### Scenario: Reused or expired token
- **WHEN** a verification token is submitted twice or after expiry
- **THEN** it is rejected and the account stays unverified

#### Scenario: Resend
- **WHEN** an authenticated unverified user requests another verification email
- **THEN** a new token is issued and any previous unconsumed verification token is invalidated

### Requirement: Forgot-password reset

The system SHALL accept a reset request for any address with a generic
response, and for a registered address SHALL email a single-use expiring reset
link, invalidating prior reset tokens; consuming it SHALL set the new password.

#### Scenario: Unknown address
- **WHEN** a reset is requested for an address with no account
- **THEN** the response is identical to the known-address response and no email is sent

#### Scenario: Reset succeeds
- **WHEN** a valid reset token is submitted with a new password meeting the policy
- **THEN** the password hash is replaced, the token is consumed, and other unconsumed reset tokens are invalidated

#### Scenario: Reused reset token
- **WHEN** a consumed or expired reset token is submitted
- **THEN** the password is not changed

### Requirement: Authenticated password change

The system SHALL let an authenticated user change their password only after
presenting the current password and a new password meeting the policy.

#### Scenario: Correct current password
- **WHEN** the current password matches and the new password is valid
- **THEN** the password hash is replaced

#### Scenario: Wrong current password
- **WHEN** the current password does not match
- **THEN** the change is rejected without a new hash being stored

### Requirement: Password change invalidates old sessions

The system SHALL record when a password changed and SHALL reject session tokens
issued before that time.

#### Scenario: Stolen session after rotation
- **WHEN** a password is changed and an older session token is presented
- **THEN** the token is rejected and the user must sign in again

### Requirement: Token storage is one-way

The system SHALL store only a hash of verification and reset tokens and SHALL
carry the raw token only in the emailed link.

#### Scenario: Storage inspection
- **WHEN** an operator reads the token table
- **THEN** no raw token usable in a link can be recovered
