---
title: "Building Production AI Agents with LangGraph"
date: 2025-01-15 09:00:00 +0000
excerpt: "LangGraph changes how we build stateful, multi-step AI agents. Here's what I've learned shipping agents to production — the patterns that work, and the pitfalls that don't."
tags:
  - AI Engineering
  - Python
  - LangChain
featured_image: /assets/images/uploads/langgraph-hero.jpg
published: true
reading_time: 8
---

After shipping several production AI agents, I keep coming back to the same hard-won lessons. LangGraph makes the *structure* of an agent explicit — and that explicitness is what makes the difference between a demo that impresses and a system that holds up in production.

## Why Graphs, Not Chains

The original LangChain model — a linear chain of calls — works great for simple pipelines. You read a document, summarise it, format the output. Done. But real-world agents need to branch, loop, backtrack, and sometimes hand off to humans. A graph is the honest data structure for that problem.

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, List

class AgentState(TypedDict):
    messages: List[dict]
    tool_results: List[dict]
    should_continue: bool

graph = StateGraph(AgentState)
graph.add_node("agent", call_model)
graph.add_node("tools", execute_tools)
graph.add_conditional_edges(
    "agent",
    should_continue,
    {"continue": "tools", "end": END}
)
```

The key insight: **state is first-class**. Every node receives the full state and returns a partial update. No hidden context, no side effects you can't trace.

## The Patterns That Actually Work

### 1. Human-in-the-loop checkpoints

Don't try to make agents fully autonomous for high-stakes decisions. Add interruption points:

```python
graph.add_node("human_review", interrupt_before_action)
graph.compile(interrupt_before=["human_review"])
```

### 2. Structured tool outputs

Unstructured strings are the enemy of reliability. Every tool should return a typed Pydantic model:

```python
class SearchResult(BaseModel):
    query: str
    results: List[str]
    confidence: float

async def web_search(query: str) -> SearchResult:
    # ...
```

### 3. Persistent state across sessions

LangGraph's checkpointer lets you resume a graph from any point. This is essential for long-running workflows:

```python
from langgraph.checkpoint.sqlite import SqliteSaver

memory = SqliteSaver.from_conn_string(":memory:")
app = graph.compile(checkpointer=memory)
```

## What I'd Tell Myself 6 Months Ago

Start with the state schema. Define it carefully, type it strictly, and resist adding fields "just in case". Every field is surface area for bugs.

Test your error paths *first*. The happy path is easy. What happens when the LLM returns malformed JSON? When a tool times out? When the user sends a blank message?

Observability is not optional. Wire up LangSmith (or an OpenTelemetry-compatible alternative) before you ship anything. Flying blind in production is how demos become incidents.

---

The full example code for this post is on [GitHub](https://github.com/Adam-S-Daniel).
