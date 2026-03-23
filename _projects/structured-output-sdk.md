---
title: "Structured Output SDK"
technology: "Python · Anthropic API · Pydantic"
url_link: "https://github.com/Adam-S-Daniel"
featured: false
images: []
---

A thin wrapper around the Anthropic API that makes structured output — forcing Claude to return data matching a Pydantic schema — a one-liner. No more brittle JSON parsing, no more `try/except json.loads`.

## Example

```python
from structured_claude import extract
from pydantic import BaseModel

class Invoice(BaseModel):
    vendor: str
    amount: float
    currency: str
    due_date: str
    line_items: list[str]

invoice = extract(Invoice, "Please process this invoice: ...")
# Returns: Invoice(vendor='Acme Corp', amount=1250.00, ...)
```

## Under the Hood

Uses Claude's tool-use API with `tool_choice={"type":"tool"}` to guarantee structured responses, with automatic retry on validation failures and a configurable max-retries budget.
