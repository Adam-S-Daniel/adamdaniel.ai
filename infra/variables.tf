variable "sprite_origin_domain" {
  description = "Hostname of the sprite URL (e.g. adamdaniel-ai-abc123.sprites.app). Print with: sprite url -s adamdaniel-ai"
  type        = string
}

variable "domain" {
  description = "Root domain"
  type        = string
  default     = "adamdaniel.ai"
}

variable "aliases" {
  description = "CloudFront alternate domain names"
  type        = list(string)
  default     = ["adamdaniel.ai", "www.adamdaniel.ai"]
}
