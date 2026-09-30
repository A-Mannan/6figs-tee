-- 6figs verification storage.
--
-- Privacy invariant: there is no column anywhere in this schema that can hold
-- an address, a balance, or a token amount. Nullifiers are opaque and one-way.
-- A CI check (see docs/INTEGRATION.md) should fail the build if a forbidden
-- column name appears.

CREATE TABLE IF NOT EXISTS identity (
  identity_nullifier TEXT PRIMARY KEY,
  tier               INTEGER NOT NULL CHECK (tier BETWEEN 0 AND 4),
  tier_label         TEXT    NOT NULL,
  portfolio_band     TEXT    NOT NULL,
  stable_bps         INTEGER NOT NULL CHECK (stable_bps BETWEEN 0 AND 10000),
  created_at         BIGINT  NOT NULL,
  expires_at         BIGINT  NOT NULL
);

CREATE INDEX IF NOT EXISTS identity_tier_idx ON identity (tier);
CREATE INDEX IF NOT EXISTS identity_expires_idx ON identity (expires_at);

-- One row per wallet currently enrolled. The unique constraint on
-- wallet_nullifier is the sybil gate: a wallet can only ever belong to one
-- identity. Membership changes are transactional and fully consented: on
-- growth every enrolled wallet re-signs and these rows are rebound to the new
-- identity; on removal the kept wallets re-sign and the removed wallets sign a
-- removal consent, after which their rows are deleted so they can be enrolled
-- elsewhere.
CREATE TABLE IF NOT EXISTS wallet_nullifier (
  wallet_nullifier  TEXT PRIMARY KEY,
  identity_nullifier TEXT NOT NULL REFERENCES identity (identity_nullifier) ON DELETE CASCADE,
  family            TEXT NOT NULL CHECK (family IN ('evm', 'solana')),
  chain_id          INTEGER NOT NULL,
  created_at        BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS wallet_nullifier_identity_idx
  ON wallet_nullifier (identity_nullifier);

-- Optional audit trail of verifications. Contains no private data.
CREATE TABLE IF NOT EXISTS verification_event (
  id                 BIGSERIAL PRIMARY KEY,
  identity_nullifier TEXT NOT NULL,
  tier               INTEGER NOT NULL,
  policy_version     TEXT NOT NULL,
  enclave_key_id     TEXT NOT NULL,
  image_digest       TEXT NOT NULL,
  created_at         BIGINT NOT NULL
);