# Architecture Decision Records

This directory holds the long-form rationale for SecureChat's
non-obvious architectural choices. The format follows
[Cognitect's ADR convention](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

| ADR                                            | Title                                           | Status   |
| ---------------------------------------------- | ----------------------------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md)  | Record architecture decisions                   | Accepted |
| [0002](0002-nacl-box-as-the-aead-primitive.md) | NaCl `box` as the AEAD primitive                | Accepted |
| [0003](0003-no-forward-secrecy.md)             | No forward secrecy in v1                        | Accepted |
| [0004](0004-relay-is-honest-but-curious.md)    | Relay is honest-but-curious, never a trust root | Accepted |

When you change a load-bearing decision (the wire protocol, the threat
model, the cryptographic primitive, the deployment model), please add
a new ADR rather than editing an existing one. ADRs are immutable once
accepted; superseding decisions get their own number and link back.
