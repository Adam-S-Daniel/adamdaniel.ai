---
title: "LangGraph Agent Framework"
technology: "Python · LangGraph · FastAPI · Redis"
url_link: "https://github.com/Adam-S-Daniel"
featured: true
images: []
---

A production-grade framework for deploying stateful, multi-step AI agents built on LangGraph. Handles human-in-the-loop interruptions, persistent checkpointing, and structured tool use — the patterns I kept rebuilding from scratch across client projects, extracted into a reusable foundation.

## Features

- **Typed state management** — Pydantic schemas enforce state shape across the graph
- **Checkpoint persistence** — resume long-running workflows across sessions with Redis or SQLite backends
- **Human-in-the-loop** — built-in interruption points with configurable approval gates
- **Streaming** — token-level and step-level streaming via Server-Sent Events
- **Observability** — LangSmith integration and OpenTelemetry traces baked in

## Why I Built It

After shipping five different agent systems for clients, I noticed I was solving the same infrastructure problems every time: where does state live? How do I let a human review before an irreversible action? How do I debug a graph run that failed two hours ago?

This framework is the answer I wished I had on project one.
