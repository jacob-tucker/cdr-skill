# CDR Tutorial

Tiny TypeScript scripts that exercise [Story Confidential Data Rails (CDR)](https://docs.story.foundation/developers/cdr-sdk/overview) on the Aeneid testnet.

Three end-to-end examples:

| Script                    | What it does                                        |
| ------------------------- | --------------------------------------------------- |
| `src/01-encrypt-text.ts`  | Encrypt + decrypt a short text secret (owner-only). |
| `src/02-encrypt-file.ts`  | Encrypt + decrypt a file via IPFS (owner-only).     |
| `src/03-license-gated.ts` | Encrypt content gated by a Story license token.     |

## Prerequisites

- Node.js 22+ (the file example uses Helia which needs 22+)
- pnpm — the CDR SDK uses workspace deps that npm/yarn can't resolve, so the whole tutorial uses pnpm too
- A funded Aeneid testnet wallet

## Setup

The SDK isn't on npm yet, so we clone it into this repo and let pnpm wire it up via `pnpm-workspace.yaml`:

```bash
git clone https://github.com/piplabs/cdr-sdk.git --branch 0.1.1 --depth 1
cd cdr-sdk && pnpm install && pnpm build && cd ..

cp .env.example .env
# fill in WALLET_PRIVATE_KEY (and IP_ID / LICENSE_TERMS_ID for the license demo)

pnpm install
```

## Run

```bash
pnpm text      # 01-encrypt-text.ts
pnpm file      # 02-encrypt-file.ts
pnpm license   # 03-license-gated.ts
```

Each script logs every transaction hash and the decrypted output.

## Agent skill

This repo also ships a [`cdr` agent skill](skills/cdr/SKILL.md) that teaches Claude Code (and any agent compatible with the [open agent skills](https://github.com/vercel-labs/skills) format) how to develop against `@piplabs/cdr-sdk`.

Install it into your project:

```bash
npx skills add jacob-tucker/cdr-skill --skill cdr
```
