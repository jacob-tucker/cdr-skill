---
name: cdr
description: Build with Story Confidential Data Rails (CDR) — threshold-encrypted vaults on Story L1 with on-chain access control. Use when the user is encrypting/decrypting data via @piplabs/cdr-sdk, allocating CDR vaults, uploading encrypted files to IPFS through CDR, or gating content behind Story license tokens / IP assets.
---

# Developing with Story CDR

CDR (Confidential Data Rails) is Story's threshold-encrypted storage. Data is encrypted locally with a DKG public key produced by the validator network; decryption requires a threshold of validators to participate AND on-chain read conditions to pass. Use this skill whenever code touches `@piplabs/cdr-sdk`.

## Mental model

There are three sub-clients on `CDRClient`:

- **`observer`** — read-only chain queries (DKG public key, threshold, fees, vault state). No wallet needed.
- **`uploader`** — allocate vaults, encrypt locally, write ciphertext on chain. Needs a wallet.
- **`consumer`** — submit a read request, gather partial decryptions from validators, combine them locally. Needs a wallet (it has to send the read tx).

Two layers of API:
- **High-level**: `uploader.uploadCDR` / `consumer.accessCDR` for inline data, `uploader.uploadFile` / `consumer.downloadFile` for file payloads. Use these by default.
- **Low-level**: `allocate` → `encryptDataKey` → `write`, and `read` → `collectPartials` → `decryptDataKey`. Reach for these only when you need manual keypair control or to interleave steps.

Inline payloads are capped at ~1024 bytes on Aeneid. Anything larger goes through `uploadFile`, which encrypts with AES, ships the ciphertext to a storage provider (IPFS via Helia is the recommended one), and stores only the AES key under CDR.

## Required setup, every time

1. Install: SDK is **not on npm** as of v0.1.1. Build from source:
   ```bash
   git clone https://github.com/piplabs/cdr-sdk.git --branch 0.1.1 --depth 1
   cd cdr-sdk && pnpm install && pnpm build
   ```
   The published SDK package declares `workspace:*` deps on `@piplabs/cdr-crypto` and `@piplabs/cdr-contracts`, which **only pnpm understands**. You can't consume it from an npm or yarn project via `file:` — npm rejects the workspace protocol. Either (a) use pnpm in the consuming project too and add the SDK packages to a `pnpm-workspace.yaml`, or (b) wait for an npm release.

2. Peer deps: `viem` v2.21+ is required. For files: `helia`, `@helia/unixfs`, `multiformats` and **Node 22+**.

3. **Always call `await initWasm()` once before any encrypt/decrypt operation.** Forgetting this is the #1 source of cryptic runtime errors. In React do it in a top-level effect or provider.

4. Network is `"testnet"` (Aeneid). Default RPC `https://aeneid.storyrpc.io`. Wallet must be funded with testnet IP.

5. Client construction:
   ```ts
   const publicClient = createPublicClient({ transport: http(RPC_URL) });
   const walletClient = createWalletClient({ account, transport: http(RPC_URL) });
   const client = new CDRClient({ network: "testnet", publicClient, walletClient });
   ```
   Read-only? Omit `walletClient` — observer methods still work.

## Access conditions (the part people get wrong)

Every vault has a `writeConditionAddr` + `readConditionAddr` (contract addresses) and matching ABI-encoded `writeConditionData` / `readConditionData`. The encoding is condition-specific.

Aeneid contracts:
- `OwnerWriteCondition` / `OwnerReadCondition`: `0x4C9bFC96d7092b590D497A191826C3dA2277c34B` — data is just `address`.
- `LicenseReadCondition`: `0xC0640AD4CF2CaA9914C8e5C44234359a9102f7a3` — data is `(address licenseToken, address ipId)`.
- `LicenseToken`: `0xFe3838BFb30B34170F00030B52eA4893d8aAC6bC`.

```ts
// Owner-only
const data = encodeAbiParameters([{ type: "address" }], [owner]);

// License-gated read
const readData = encodeAbiParameters(
  [{ type: "address" }, { type: "address" }],
  [LICENSE_TOKEN, ipId],
);
```

For license-gated reads, `accessCDR` must receive `accessAuxData` containing the license token id(s):
```ts
const accessAuxData = encodeAbiParameters(
  [{ type: "uint256[]" }],
  [[BigInt(licenseTokenId)]],
);
```

Helper encoders also exist if you don't want to encode by hand: `conditions.ownerOnly()`, `conditions.tokenGate()`, `conditions.merkle()`, `conditions.custom()`, `conditions.open()`.

## Canonical happy paths

**Text**: `initWasm` → `observer.getGlobalPubKey` → encode bytes → `uploader.uploadCDR` → `consumer.accessCDR`.

**File**: same, but also boot Helia and pass a `HeliaProvider` as `storageProvider` to both `uploadFile` and `downloadFile`. Always pass `timeoutMs: 120_000` to reads — partial collection is async.

**License-gated**: same upload path but with `LICENSE_READ_CONDITION` + `(licenseToken, ipId)` data. The reader must mint a license token first (wrap IP→WIP, approve `RoyaltyModule`, then `storyClient.license.mintLicenseTokens`), and pass the token id via `accessAuxData` on read.

## Things that bite you

- **`initWasm` not called** → opaque "wasm not initialized" failures from encrypt/decrypt.
- **Inline data > 1024 bytes** → use `uploadFile`, not `uploadCDR`.
- **Helia on Node < 22** → switch runtime, or use a different storage provider (Storacha / Synapse / gateway-backed IPFS are listed in advanced config).
- **License read but no `accessAuxData`** → read condition rejects the request. The license token id must be ABI-encoded as `uint256[]`.
- **Edge runtime (Vercel edge / Cloudflare workers)** → not supported. Use Node or browser.
- **Missing `walletClient`** → observer-only. Any uploader/consumer call will throw.
- **Aeneid is testnet** — explicitly not production-grade confidentiality. Don't put real secrets in.

## Reference

- Overview: https://docs.story.foundation/developers/cdr-sdk/overview
- Setup: https://docs.story.foundation/developers/cdr-sdk/setup
- Encrypt/decrypt: https://docs.story.foundation/developers/cdr-sdk/encrypt-and-decrypt
- IP asset / license vaults: https://docs.story.foundation/developers/cdr-sdk/ip-asset-vaults
- Advanced config (DKG sources, validation RPCs, storage backends): https://docs.story.foundation/developers/cdr-sdk/advanced-configuration
- SDK reference: https://docs.story.foundation/sdk-reference/cdr/overview

When in doubt, read the doc page that matches the user's task before writing code — the SDK is pre-1.0 and surface details (helper aliases like `createVault`/`readVault`, condition encoders) are still moving.
