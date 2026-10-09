# Tasks: pricing throughput

- [x] Batch CoinGecko resolution by platform + natives (`quoteMany`)
- [x] Bounded-parallel fallback fan-out (`mapLimit`, `quoteAll`)
- [x] Miss caching in all three providers (same TTL)
- [x] `valueBalances` consumes one `quoteAll` pass
- [x] Tests: batch call counts, fallback priority under batch, chunk-failure degradation, miss-cache call counts, `quoteAll`/`mapLimit` units
- [x] Full suite green (140/140) + `tsc --noEmit` clean
- [x] Benchmark: 24-asset wallet, 40ms/call stub — 30 calls/1344ms sequential vs 9 calls/209ms batched
- [x] Parallel EVM chain + token discovery with deterministic merge
- [x] Parallel Solana programs + per-account agreement with deterministic merge
- [x] Tests: merge order under concurrency, deterministic cap truncation, disagreement propagation (EVM + Solana)
- [x] Full suite green (145/145) + `tsc --noEmit` clean
- [x] Benchmark: 2-chain + Solana wallet, 40ms/RPC stub — 1480ms serialized vs 356ms parallel (4.2x), identical balances
- [ ] Rebuild the enclave image (`scripts/build-image.sh`), pin the new digest in backend (`SIXFIGS_IMAGE_DIGEST`) and frontend (`NEXT_PUBLIC_IMAGE_DIGEST`), redeploy (`scripts/create-vm.sh`)
