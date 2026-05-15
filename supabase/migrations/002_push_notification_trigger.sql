-- Trigger to call Edge Function when a new chat message is inserted
-- This uses Supabase's pg_net extension to make HTTP calls from PostgreSQL

CREATE OR REPLACE FUNCTION notify_new_chat_message()
RETURNS TRIGGER AS $$
DECLARE
  sender_name TEXT;
  project_title TEXT;
BEGIN
  SELECT full_name INTO sender_name FROM profiles WHERE id = NEW.sender_id;
  SELECT title INTO project_title FROM projects WHERE id = NEW.project_id;

  PERFORM net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := jsonb_build_object(
      'project_id', NEW.project_id,
      'sender_id', NEW.sender_id,
      'title', COALESCE(sender_name, 'Uusi viesti'),
      'body', LEFT(NEW.content, 200),
      'type', 'chat_message'
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Only create trigger if pg_net extension is available
-- You need to enable pg_net in Supabase Dashboard > Database > Extensions
CREATE TRIGGER on_new_chat_message
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION notify_new_chat_message();
