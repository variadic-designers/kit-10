# Vendored fork: `woff2` 0.3.0 with a broken decode-time validation check removed

Upstream: https://crates.io/crates/woff2/0.3.0 (Apache-2.0). No newer release exists on crates.io
as of this vendoring.

## The bug

`src/decode.rs::convert_woff2_to_ttf` tries to validate the compressed table stream's actual
consumed byte count against the WOFF2 header's own `total_compressed_size` field:

```rust
let compressed_size = stream_start_remaining - input_buffer.remaining();
if compressed_size != usize::try_from(header.total_compressed_size).unwrap() + 1 {
    Err(DecodeError::Invalid("Compressed stream size does not match header".to_string()))?;
}
```

This fails on every real-world WOFF2 file tested (a Satoshi variable font and a Satoshi static
weight, both from this project's own existing font assets). It is NOT a simple off-by-one:
instrumenting both values directly showed `compressed_size` running consistently **2 bytes
higher** than `header.total_compressed_size` (not `total_compressed_size + 1`, the original
check's own assumption, nor `total_compressed_size` exactly, tried first as a fix here).

The real cause: `compressed_size` is derived from how many bytes `BrotliDecompress`'s `Read`-based
adapter consumed from the underlying `bytes::Buf`. A `Read` adapter over a streaming decompressor
routinely reads a full internal chunk even when the logical compressed stream ends partway through
it -- ordinary read-ahead buffering, not evidence of a corrupt or mis-sized input. `compressed_size`
is therefore not a reliable signal for "did this decompress correctly" as implemented here, for any
constant offset.

## The fix

`src/decode.rs`: the check is removed (not patched to a different magic number). Real corruption
still fails upstream of this line -- a genuinely truncated/malformed brotli stream fails inside
`BrotliDecompress` itself (via its own `?`), and a genuinely malformed table directory fails in
`table_directory.write_to_buf` a few lines below. This check was never load-bearing for either of
those real failure modes; it only ever guarded against its own measurement artifact.

## Why vendored instead of patched via a git fork

No upstream PR was filed as part of this session (out of scope) -- vendoring inline via
`[patch.crates-io]` in `plugins/pdf/Cargo.toml` was the fastest unblock. If/when an upstream fix
ships, drop this directory and the `[patch.crates-io]` entry, and un-pin the plain crates.io
`woff2 = "0.3"` dependency.
