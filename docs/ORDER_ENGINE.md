# Order engine

The offline prototype engine returns the `DraftOrder` contract.

## Deterministic engine

This credential-free path supports the product demos and repeatable tests. It
normalizes Dutch, French, English, and informal aliases; detects questions; ignores
waiter repetition; waits for accepted waiter suggestions; and applies additions,
quantity changes, replacements, and cancellations to conversational state.

It also handles implicit quantity (“voor ons allebei”), required modifiers, allergy
warnings, free-text “apart” notes, course exceptions, and a single clear historical
referent. The rule set is deliberately finite; unsupported language becomes an
unresolved item instead of a guess.

## Draft states

- `NOT_SENT`: local or server draft, editable and recoverable.
- `SENT`: transmitted to an adapter draft; still not final-confirmed.
- `ERROR`: last transmission failed; manual retry is available.

Blocking issue types are ambiguity, unresolved product, missing modifier, and course
exception. All draft submissions receive a second validation pass and stable
idempotency key.
