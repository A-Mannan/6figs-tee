const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ALPHABET_MAP = new Map<string, number>(
  [...ALPHABET].map((char, index) => [char, index]),
);

/**
 * Bitcoin-alphabet base58 decode, used for Solana public keys and signatures.
 * BigInt-based for clarity; inputs here are at most 64 bytes so speed is moot.
 */
export function base58Decode(input: string): Uint8Array {
  if (input.length === 0) return new Uint8Array(0);
  let zeros = 0;
  while (zeros < input.length && input[zeros] === "1") zeros++;

  let value = 0n;
  for (let i = zeros; i < input.length; i++) {
    const char = input[i]!;
    const digit = ALPHABET_MAP.get(char);
    if (digit === undefined) throw new Error(`base58: invalid character ${char}`);
    value = value * 58n + BigInt(digit);
  }

  const body: number[] = [];
  while (value > 0n) {
    body.unshift(Number(value & 0xffn));
    value >>= 8n;
  }

  const out = new Uint8Array(zeros + body.length);
  out.set(body, zeros);
  return out;
}

/** Bitcoin-alphabet base58 encode. */
export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  let value = 0n;
  for (let i = zeros; i < bytes.length; i++) {
    value = (value << 8n) | BigInt(bytes[i]!);
  }

  const digits: string[] = [];
  while (value > 0n) {
    digits.push(ALPHABET[Number(value % 58n)]!);
    value /= 58n;
  }
  return "1".repeat(zeros) + digits.reverse().join("");
}