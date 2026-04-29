terraform {
  required_version = ">= 1.4.0"
}

resource "terraform_data" "example" {
  input = "terraform-plan-commenter-action"
}
