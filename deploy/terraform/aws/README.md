# Terraform — AWS (minimal)

Provisions **RDS Postgres 16** and an **ECS cluster** skeleton. Add task definitions, ALB, and Secrets Manager for a full production cut.

```bash
cd deploy/terraform/aws
terraform init
terraform apply -var='db_password=change-me'
```

Set `DATABASE_URL` on the agent-todo server to the `database_url` output (via PgBouncer in production).
