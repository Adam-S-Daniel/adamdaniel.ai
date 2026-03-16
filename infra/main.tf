terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# ACM certs used with CloudFront must be provisioned in us-east-1
provider "aws" {
  region = "us-east-1"
}

# ---------------------------------------------------------------------------
# ACM wildcard certificate for *.adamdaniel.ai
# Covers www.adamdaniel.ai, any future subdomain, and the apex domain.
# ---------------------------------------------------------------------------
resource "aws_acm_certificate" "wildcard" {
  domain_name               = var.domain               # adamdaniel.ai (apex)
  subject_alternative_names = ["*.${var.domain}"]      # *.adamdaniel.ai

  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Project = "adamdaniel-ai"
  }
}

# Output the DNS records you need to add to your registrar/DNS provider
# to complete ACM domain validation before CloudFront can use the cert.
output "acm_validation_records" {
  description = "Add these CNAME records to your DNS to validate the ACM certificate"
  value = {
    for dvo in aws_acm_certificate.wildcard.domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  }
}

resource "aws_acm_certificate_validation" "wildcard" {
  certificate_arn = aws_acm_certificate.wildcard.arn

  # If you manage DNS in Route 53, uncomment the validation_record_fqdns
  # block below and wire it to aws_route53_record resources instead.
  # For external DNS, add the records manually and Terraform will wait.
  timeouts {
    create = "30m"
  }
}

# ---------------------------------------------------------------------------
# CloudFront distribution
# Origin: the sprite's public sprites.app HTTPS URL
# ---------------------------------------------------------------------------
resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "adamdaniel.ai → sprites.dev origin"
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # North America + Europe, cheapest

  aliases = var.aliases

  # Sprite origin — sprites.dev terminates TLS, nginx serves port 80 internally
  origin {
    domain_name = var.sprite_origin_domain
    origin_id   = "sprite"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    # Forward a Host header so nginx can route correctly if needed
    custom_header {
      name  = "X-Forwarded-Host"
      value = var.domain
    }
  }

  default_cache_behavior {
    target_origin_id       = "sprite"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    # ^ AWS managed "CachingOptimized" policy — good defaults for static sites
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.wildcard.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = {
    Project = "adamdaniel-ai"
  }
}
