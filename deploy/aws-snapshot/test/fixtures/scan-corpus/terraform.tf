resource "aws_lambda_function" "fn" {
  environment {
    variables = {
      DB_PASSWORD = "S3cretPassw0rd!"
      TOKEN = var.token
    }
  }
  user_data = "x"
}
resource "aws_ecs_task_definition" "t" {
  container_definitions = jsonencode([{ name = "app", environment = [{ name = "DB_PASSWORD", value = "plain" }] }])
}
resource "aws_db_instance" "db" {
  password = var.db_password
  master_password = "hunter2hunter2"
}
