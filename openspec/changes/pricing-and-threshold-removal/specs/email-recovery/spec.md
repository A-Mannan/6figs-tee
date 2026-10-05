# Spec Delta

## Purpose

Use the Resend API for account email in the NestJS backend instead of running
our own outbound mail infrastructure.

## ADDED Requirements

### Requirement: Resend delivery takes precedence

The mailer SHALL send through the Resend API when `RESEND_API_KEY` is set,
before trying SMTP, and SHALL keep the console transport as the development
fallback; production still refuses to boot without a provider unless the
explicit console override is set.

#### Scenario: Resend configured
- **WHEN** `RESEND_API_KEY` is set
- **THEN** verification and reset email is sent through Resend and no SMTP transport is used

#### Scenario: Degraded configuration
- **WHEN** no Resend key and no SMTP host are configured in development
- **THEN** the link is logged through the console transport

#### Scenario: Placeholder key
- **WHEN** the operator has not replaced the `re_xxxxxxxxx` placeholder with a real key
- **THEN** development still logs links locally and a production boot is treated as unconfigured