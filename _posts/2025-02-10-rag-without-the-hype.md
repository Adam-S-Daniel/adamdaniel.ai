---
title: "Suspendisse Potenti: Curabitur Sodales Ligula"
permalink_slug: rag-without-the-hype
date: 2025-02-10 09:00:00 +0000
excerpt: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas."
tags:
  - AI Engineering
  - RAG
  - Python
published: true
reading_time: 6
---

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus luctus urna sed urna ultricies ac tempor dui sagittis. In condimentum facilisis porta. Sed nec diam eu diam mattis viverra.

Nulla at nulla justo, eget luctus tortor. Nulla facilisi. Duis aliquet egestas purus in blandit. Curabitur vulputate, ligula lacinia scelerisque tempor, lacus lacus ornare ante, ac egestas est urna sit amet arcu.

## Suspendisse Potenti

Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Curabitur sodales ligula in libero. Sed dignissim lacinia nunc.

Praesent dapibus, neque id cursus faucibus, tortor neque egestas augue:

1. **Nulla gravida** — orci a odio. Nullam varius, turpis et commodo pharetra, est eros bibendum elit, nec luctus magna felis sollicitudin mauris.

2. **Pellentesque fermentum** — dolor. Aliquam quam lectus, facilisis auctor, ultrices ut, elementum vulputate, nunc.

3. **Morbi est est** — blandit sit amet, sagittis vel, euismod vel, velit. Quisque ullamcorper placerat ipsum.

```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")

def rerank(query: str, docs: list[str], top_k: int = 3) -> list[str]:
    pairs = [(query, doc) for doc in docs]
    scores = reranker.predict(pairs)
    ranked = sorted(zip(docs, scores), key=lambda x: x[1], reverse=True)
    return [doc for doc, _ in ranked[:top_k]]
```

## Curabitur Tortor

Curabitur tortor. Pellentesque nibh. Aenean quam. In scelerisque sem at dolor. Maecenas mattis. Sed convallis tristique sem. Proin ut ligula vel nunc egestas porttitor.

- **Recall@k** — morbi lectus risus, iaculis vel, suscipit quis, luctus non, massa.
- **Fusce ac turpis** — quis ligula lacinia aliquet. Mauris ipsum. Nulla metus metus.
- **Vestibulum lacinia** — arcu eget nulla. Class aptent taciti sociosqu ad litora torquent.

Sed adipiscing ornare risus. Morbi est est, blandit sit amet, sagittis vel, euismod vel, velit.

## Donec Lobortis

Donec lobortis risus a elit. Etiam tempor. Ut ullamcorper, ligula ut dictum pharetra, nisi nunc fringilla magna, in commodo elit erat nec turpis. Ut pharetra augue nec augue. Nam elit magna, hendrerit sit amet, tincidunt ac, viverra sed, nulla.

Donec porta diam eu massa. Quisque diam lorem, interdum vitae, dapibus ac, scelerisque vitae, pede.
