terraform {
  required_version = ">= 1.4.0"
}

variable "required_input" {
  type = string
}

resource "terraform_data" "example" {
  input = var.required_input
}
