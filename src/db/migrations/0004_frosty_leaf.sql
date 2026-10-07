-- Add owner card message ID to orders table
ALTER TABLE orders ADD COLUMN owner_card_message_id INTEGER;

-- Add index for efficient lookup
CREATE INDEX orders_owner_card_message_idx ON orders(tenant_id, owner_card_message_id);