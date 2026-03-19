---
title: "RAG Without the Hype: What Actually Improves Retrieval Quality"
date: 2025-02-10 09:00:00 +0000
excerpt: "Retrieval-augmented generation is oversold and underengineered. Here's the practical guide to building RAG systems that give useful answers instead of confident hallucinations."
tags:
  - AI Engineering
  - RAG
  - Python
published: true
reading_time: 6
---

Everyone is building RAG. Most of it doesn't work very well. The benchmark numbers look impressive; the production behaviour does not.

Here's the uncomfortable truth: the retrieval half of RAG is mostly an information retrieval problem from the 1970s, and most teams treat it as an afterthought because the LLM half feels more exciting.

## The Real Bottleneck

Your retrieval quality sets a hard ceiling on your generation quality. You can use the best model in the world — if the retrieved chunks are noisy or irrelevant, the answer will be too.

The biggest gains I've seen come from:

1. **Chunk strategy** — most systems chunk by fixed token count. Don't. Chunk by semantic unit (paragraph, section, function). The meaning of a sentence depends on its context.

2. **Metadata filtering** — before even running vector search, filter by date, author, document type. Hybrid search (keyword + vector) consistently outperforms pure semantic search on real corpora.

3. **Reranking** — run a cross-encoder reranker over the top-k candidates. It's cheap and lifts precision dramatically.

```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")

def rerank(query: str, docs: list[str], top_k: int = 3) -> list[str]:
    pairs = [(query, doc) for doc in docs]
    scores = reranker.predict(pairs)
    ranked = sorted(zip(docs, scores), key=lambda x: x[1], reverse=True)
    return [doc for doc, _ in ranked[:top_k]]
```

## Evaluation Is Non-Negotiable

You can't improve what you don't measure. Build a small golden dataset (50–100 question/answer pairs from your domain) and track:

- **Recall@k** — was the right document in the top k results?
- **Answer faithfulness** — does the generated answer stick to the retrieved context, or does the model hallucinate?
- **Answer relevance** — does the answer actually address the question?

[Ragas](https://github.com/explodinggradients/ragas) is the fastest way to get these metrics without writing everything from scratch.

## The One Change That Helps Most

If you only make one improvement: **add a query rewriting step**. User queries are messy. A brief rephrasing pass — "given this query, write 3 variants optimised for document retrieval" — meaningfully improves recall across every corpus I've tested it on.

The cost is one extra LLM call. The benefit is worth it.
