---
title: "Donec Nec Justo Eget Felis"
technology: "Python · Anthropic API · Pydantic"
url_link: "https://github.com/Adam-S-Daniel"
featured: false
images: []
---

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

## Example

```python
from structured_claude import extract
from pydantic import BaseModel

class LoremIpsum(BaseModel):
    dolor: str
    sit_amet: float
    consectetur: str
    adipiscing: str
    elit: list[str]

result = extract(LoremIpsum, "Lorem ipsum dolor sit amet...")
# Returns: LoremIpsum(dolor='Sed do', sit_amet=42.0, ...)
```

## Pellentesque Habitant

Morbi tristique senectus et netus et malesuada fames ac turpis egestas. Vestibulum tortor quam, feugiat vitae, ultricies eget, tempor sit amet, ante. Donec eu libero sit amet quam egestas semper.
