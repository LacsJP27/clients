# Architecture Decision Records

An architecture decision record (ADR) captures one significant architectural decision: the context
that forced it, the decision itself, and the consequences accepted along with it. The record is
written once the decision is made and is not rewritten afterwards — a decision that no longer holds
is superseded by a new ADR rather than edited in place.

## Scope of this directory

These ADRs cover decisions made **in this repository**. Bitwarden's organization-wide ADRs are
published separately at
[contributing.bitwarden.com/architecture/adr](https://contributing.bitwarden.com/architecture/adr/)
and are referenced from `.claude/rules/` by URL (for example ADR-0010, Clients Use Jest Mocks). The
two numbering sequences are independent, so always cite upstream records by their full URL and
local records by relative path to avoid ambiguity.

## Index

| ADR                                         | Title                     | Status   |
| ------------------------------------------- | ------------------------- | -------- |
| [0001](./0001-shared-platform-contracts.md) | Shared Platform Contracts | Proposed |

## Conventions

- **Filename:** `NNNN-kebab-case-title.md`, with `NNNN` the next unused four-digit number.
- **Status:** one of
  - `Proposed` — written and under review; not yet agreed.
  - `Accepted` — agreed and being implemented or implemented.
  - `Superseded by ADR-NNNN` — replaced; the record stays in place for history.
  - `Rejected` — considered and declined; kept so the reasoning is not relitigated.
- **Scale:** one decision per record. If a document needs two Decision sections, it is two ADRs.
- **Tense:** state the decision as a decision ("storage and secure storage are separate contracts"),
  not as a plan or a suggestion.
- **Assets:** diagrams and images go in `./assets/`, referenced relatively.
- Update the index table above in the same change that adds a record.

## Template

```markdown
# ADR-NNNN — Title

- **Status:** Proposed
- **Date:** YYYY-MM-DD
- **Deciders:** <teams or roles>
- **Affects:** <apps and libs>

## Context

The forces at play: the constraint, the problem, the relevant existing code, and what makes a
decision necessary now. Facts, not preferences.

## Decision

What is being done, stated plainly. Include the specific components, types, or boundaries
introduced, and the rules that follow from the decision.

## Alternatives considered

Each option seriously weighed, and why it was not chosen.

## Consequences

### Positive

### Negative

### Neutral

## Validation

How anyone can tell whether the decision was honored: tests, type checks, lint boundaries.

## References

Related ADRs, relevant files, and external documentation.
```
