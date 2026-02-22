docker run --name meeting-assistant-postgres \
  -e POSTGRES_USER=meeting_assistant \
  -e POSTGRES_PASSWORD=meeting_assistant \
  -e POSTGRES_DB=meeting_assistant \
  -p 5432:5432 \
  -d postgres