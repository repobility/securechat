# ADR 0001 — Record architecture decisions

- **Status**: Accepted
- **Date**: 2026-05-10

## Context

SecureChat makes several non-obvious architectural choices (no forward
secrecy, no server persistence, NaCl over Web Crypto, etc.). Future
contributors and security reviewers need to know not just _what_ was
chosen but _why_, so that proposed changes can be evaluated against the
original constraints.

## Decision

We will record significant architectural decisions as
[Architecture Decision Records](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
under [`docs/adr/`](.). Each record:

- has a short imperative title prefixed by a four-digit number;
- captures **Context**, **Decision**, and **Consequences**;
- is immutable once accepted — superseded decisions get a new record
  with a `Superseded by ADR-NNNN` link instead of edits in place.

## Consequences

- Reviewers reading a PR that touches the relay protocol, the wire
  format, or the cryptographic core can quickly find the relevant ADR
  and cite it.
- Out-of-date ADRs are explicitly visible (status: `Superseded`) instead
  of silently dropped.
- New decisions are deliberate: the act of writing the ADR forces the
  author to articulate trade-offs.
