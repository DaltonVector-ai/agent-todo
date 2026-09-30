# Terraform — GCP (minimal)

Creates **Cloud SQL Postgres 16** and a **Cloud Run** service (min 2 instances). Replace the container image and database credentials before applying in production.

```bash
cd deploy/terraform/gcp
terraform init
terraform apply -var='project_id=my-gcp-project'
```
