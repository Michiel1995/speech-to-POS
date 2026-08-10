# Semantic mapping

The active POS menu is the hard source of truth. Each product keeps its immutable POS
ID/SKU/name beside a canonical name and restaurant language aliases. The seed menu
intentionally includes abbreviations, an archived product, and duplicate house wines.

## Match order

1. Normalize case, punctuation, diacritics, and spacing.
2. Prefer the longest exact menu/alias occurrence.
3. Preserve all active products sharing the same exact phrase.
4. Show at most five candidates without a preselected “AI favorite.”
5. Match modifiers only inside groups allowed by the chosen product.
6. Validate active state, IDs, quantity, group membership, and required minima/maxima.

An unknown phrase creates no line. An archived item is excluded. Prices always come
from the menu.

## Learning

Corrections store only a short spoken fragment, old/new product IDs, error category,
confidence, tenant, waiter, and timestamp. One correction changes nothing globally.
After a configurable repeated threshold, the system creates a proposal requiring
manager approval. Personal pattern weight decays over 30 days and cannot override
restaurant menu truth.

The MVP includes this domain logic but not the manager approval screen or durable
database.
