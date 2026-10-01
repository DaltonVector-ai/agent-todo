terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "name" {
  type    = string
  default = "agent-todo"
}

resource "google_sql_database_instance" "postgres" {
  name             = "${var.name}-pg"
  database_version = "POSTGRES_16"
  region           = var.region
  settings {
    tier = "db-custom-2-7680"
  }
}

resource "google_sql_database" "db" {
  name     = "agenttodo"
  instance = google_sql_database_instance.postgres.name
}

resource "google_cloud_run_v2_service" "server" {
  name     = var.name
  location = var.region
  template {
    containers {
      image = "gcr.io/${var.project_id}/agent-todo:latest"
      env {
        name  = "PORT"
        value = "8080"
      }
      env {
        name  = "DATABASE_URL"
        value = "postgres://user:pass@/${google_sql_database.db.name}?host=/cloudsql/${google_sql_database_instance.postgres.connection_name}"
      }
    }
    scaling {
      min_instance_count = 2
    }
  }
}

output "cloud_run_uri" {
  value = google_cloud_run_v2_service.server.uri
}

output "sql_connection_name" {
  value = google_sql_database_instance.postgres.connection_name
}
