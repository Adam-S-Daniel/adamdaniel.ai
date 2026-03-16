output "cloudfront_domain" {
  description = "Point your DNS CNAME/ALIAS records here"
  value       = aws_cloudfront_distribution.main.domain_name
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "acm_certificate_arn" {
  value = aws_acm_certificate.wildcard.arn
}
