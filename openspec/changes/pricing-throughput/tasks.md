# Tasks: pricing throughput

- [x] Batch CoinGecko resolution by platform + natives (`quoteMany`)
- [x] Bounded-parallel fallback fan-out (`mapLimit`, `quoteAll`)
- [x] Miss caching in all three providers (same TTL)
- [x] `valueBalances` consumes one `quoteAll` pass
- [x] Tests: batch call counts, fallback priority under batch, chunk-failure degradation, miss-cache call counts, `quoteAll`/`mapLimit` units
- [x] Full suite green (140/140) + `tsc --noEmit` clean
- [x] Benchmark: 24-asset wallet, 40ms/call stub — 30 calls/1344ms sequential vs 9 calls/209ms batched
- [ ] Rebuild the enclave image (`scripts/build-image.sh`), pin the new digest in backend (`SIXFIGS_IMAGE_DIGEST`) and frontend (`NEXT_PUBLIC_IMAGE_DIGEST`), redeploy (`scripts/create-vm.sh`)
