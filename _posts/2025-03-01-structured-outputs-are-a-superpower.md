---
title: "Structured Outputs Are a Superpower"
date: 2025-03-01 09:00:00 +0000
excerpt: "Constrained generation — forcing an LLM to produce valid JSON matching a schema — is one of the highest-leverage techniques in AI engineering. Here's how to use it effectively."
tags:
  - AI Engineering
  - Python
  - Best Practices
published: true
reading_time: 5
---

The single change that most reliably makes AI features production-ready is switching from unstructured text output to structured, schema-validated output.

Free-form text responses require fragile parsing. They drift with model updates. They silently fail in ways that are hard to catch. Structured output solves all of this.

## Using Pydantic with the Claude API

```python
from anthropic import Anthropic
import anthropic
from pydantic import BaseModel

class BlogPostAnalysis(BaseModel):
    sentiment: str          # "positive" | "negative" | "neutral"
    topics: list[str]
    reading_level: str      # "beginner" | "intermediate" | "advanced"
    summary: str

client = Anthropic()

def analyse_post(content: str) -> BlogPostAnalysis:
    message = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=1024,
        tools=[{
            "name": "analyse_post",
            "description": "Analyse a blog post and return structured metadata",
            "input_schema": BlogPostAnalysis.model_json_schema()
        }],
        tool_choice={"type": "tool", "name": "analyse_post"},
        messages=[{
            "role": "user",
            "content": f"Analyse this blog post:\n\n{content}"
        }]
    )

    tool_result = next(
        b for b in message.content if b.type == "tool_use"
    )
    return BlogPostAnalysis(**tool_result.input)
```

The key is `tool_choice={"type": "tool", "name": "..."}` — this *forces* the model to call your tool rather than returning prose. You get guaranteed-valid structured data.

## The Patterns I Use Everywhere

**Discriminated unions** for branching logic:

```python
from typing import Literal, Union
from pydantic import BaseModel

class SuccessResult(BaseModel):
    status: Literal["success"]
    data: dict

class ErrorResult(BaseModel):
    status: Literal["error"]
    message: str
    retry_suggested: bool

AgentResult = Union[SuccessResult, ErrorResult]
```

**Nested schemas** for complex extractions — don't flatten everything into a single level. Hierarchical Pydantic models give you natural grouping and better validation.

**Strict mode** when reliability matters most — `model_config = ConfigDict(strict=True)` rejects coercion and surfaces type mismatches immediately.

## When to Reach for This

Not every LLM call needs structured output. Conversational responses, creative writing, explanations — free text is fine. But any time you're:

- Feeding LLM output into code
- Storing results in a database
- Branching logic on LLM decisions
- Rendering structured UI components from LLM data

...use structured output. It's the difference between a prototype and a system.
