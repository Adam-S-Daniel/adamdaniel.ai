---
title: "RAG Evaluation Toolkit"
technology: "Python · Ragas · LangSmith · Pydantic"
url_link: "https://github.com/Adam-S-Daniel"
featured: true
images: []
---

An opinionated evaluation harness for RAG pipelines. Runs automated quality checks against a golden dataset and surfaces retrieval and generation metrics in a single dashboard — because you can't improve what you don't measure.

## Metrics

- **Recall@k** — how often the correct document appears in retrieved results
- **Answer faithfulness** — does the answer hallucinate beyond the retrieved context?
- **Answer relevance** — does it actually address the question?
- **Chunk quality** — signal-to-noise ratio in retrieved chunks

## Usage

```bash
pip install rag-eval-toolkit

rag-eval run \
  --pipeline ./my_pipeline.py \
  --golden-set ./eval_data.jsonl \
  --output ./report.html
```

The HTML report shows per-question breakdowns, aggregate scores, and a regression diff against the previous run — so you can tell immediately whether a retrieval change helped or hurt.
