terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "name" {
  type    = string
  default = "agent-todo"
}

variable "db_password" {
  type      = string
  sensitive = true
}

resource "aws_db_instance" "postgres" {
  identifier              = "${var.name}-pg"
  engine                  = "postgres"
  engine_version          = "16"
  instance_class          = "db.t4g.medium"
  allocated_storage       = 50
  username                = "agent"
  password                = var.db_password
  db_name                 = "agenttodo"
  skip_final_snapshot     = true
  publicly_accessible     = false
  backup_retention_period = 7
}

resource "aws_ecs_cluster" "this" {
  name = var.name
}

# Wire ECS service + task definition to deploy/Dockerfile image and DATABASE_URL from RDS.
# Extend with ALB, secrets manager, and autoscaling for production.

output "database_url" {
  value     = "postgres://agent:${var.db_password}@${aws_db_instance.postgres.address}:5432/agenttodo"
  sensitive = true
}

output "rds_endpoint" {
  value = aws_db_instance.postgres.address
}
