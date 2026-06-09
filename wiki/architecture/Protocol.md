# Wire Protocol

> The single contract both sides agree on, defined in `src/shared/protocol.ts`.

## Principles

- **JSON today**, deliberately. It's debuggable and simple; a binary/quantized format
  (see SparkEngine's `NetQuantize`) is a later optimization, not a starting requirement.
- **Decode defensively.** `decodeClient` / `decodeServer` return `null` on malformed input —
  callers drop bad messages rather than trusting them.
- **Intent in, state out.** Clients send `join`/`input`/`admin`; the server sends
  `welcome`/`snapshot`/`admin_result`.

## Client → Server

| Message | Shape | Notes |
|---|---|---|
| `join` | `{ t:'join', name }` | Once per connection; server assigns an id. |
| `input` | `{ t:'input', input:{up,down,left,right} }` | Intent only; validated at simulate time. |
| `admin` | `{ t:'admin', token, command }` | Privileged; token-gated server-side. |

## Server → Client

| Message | Shape | Notes |
|---|---|---|
| `welcome` | `{ t:'welcome', id, tickRate, world }` | Sent after `join`. |
| `snapshot` | `{ t:'snapshot', tick, entities[] }` | Broadcast every tick. |
| `admin_result` | `{ t:'admin_result', ok, message }` | Result of an admin command. |

## Changing the protocol

1. Add/adjust the variant in `src/shared/protocol.ts` (both sides see it immediately).
2. Handle it on the server (`src/server/index.ts`) and client (`src/client/net.ts`).
3. Keep decoders defensive; never assume a field exists.
4. Add a test and a `CHANGELOG.md` entry.

## See also

- [Architecture Overview](Overview.md)
- [Threat Model](../security/Threat-Model.md)
