-- Add customer dialog message ID to relay_messages for single-screen dialog
ALTER TABLE relay_messages ADD COLUMN customer_dialog_message_id INTEGER;

-- Add index for efficient lookup
CREATE INDEX relay_customer_dialog_idx ON relay_messages(tenant_id, customer_id, customer_dialog_message_id);