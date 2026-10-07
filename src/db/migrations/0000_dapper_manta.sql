CREATE TABLE `capacity_overrides` (
	`tenant_id` text NOT NULL,
	`date` text NOT NULL,
	`capacity` integer NOT NULL,
	`is_closed` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`tenant_id`, `date`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`title` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`telegram_id` integer NOT NULL,
	`username` text,
	`first_name` text,
	`phone` text,
	`source` text,
	`is_blocked` integer DEFAULT false NOT NULL,
	`bot_blocked` integer DEFAULT false NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `faq_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `funnel_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`type` text NOT NULL,
	`source` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`tenant_id` text,
	`payload` text NOT NULL,
	`run_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`dedupe_key` text NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `order_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`kind` text NOT NULL,
	`file_id` text NOT NULL,
	`file_type` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`type` text NOT NULL,
	`actor` text NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text,
	`title_snapshot` text NOT NULL,
	`options_snapshot` text NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`qty` integer NOT NULL,
	`capacity_units` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`number` integer NOT NULL,
	`customer_id` text NOT NULL,
	`status` text NOT NULL,
	`due_date` text NOT NULL,
	`proposed_date` text,
	`due_time_text` text,
	`fulfillment` text NOT NULL,
	`address` text,
	`contact_name` text NOT NULL,
	`contact_phone` text NOT NULL,
	`comment` text,
	`items_total_minor` integer NOT NULL,
	`delivery_fee_minor` integer DEFAULT 0 NOT NULL,
	`total_minor` integer NOT NULL,
	`prepayment_minor` integer NOT NULL,
	`capacity_units` integer NOT NULL,
	`source` text,
	`idempotency_key` text NOT NULL,
	`payment_due_at` integer,
	`reject_reason` text,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `product_options` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`group_title` text NOT NULL,
	`title` text NOT NULL,
	`price_delta_minor` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`category_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`price_minor` integer NOT NULL,
	`unit` text DEFAULT 'шт' NOT NULL,
	`min_qty` integer DEFAULT 1 NOT NULL,
	`max_qty` integer DEFAULT 50 NOT NULL,
	`lead_days` integer,
	`capacity_units` integer DEFAULT 1 NOT NULL,
	`photo_file_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `relay_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`owner_chat_id` integer NOT NULL,
	`owner_message_id` integer NOT NULL,
	`customer_chat_id` integer NOT NULL,
	`order_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`tenant_id` text NOT NULL,
	`telegram_id` integer NOT NULL,
	`state` text DEFAULT 'idle' NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `telegram_id`)
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `code`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`bot_token_enc` text NOT NULL,
	`bot_id` integer NOT NULL,
	`bot_username` text NOT NULL,
	`owner_telegram_id` integer,
	`claim_code_hash` text,
	`claim_expires_at` integer,
	`shop_name` text NOT NULL,
	`currency` text DEFAULT '₽' NOT NULL,
	`timezone` text DEFAULT 'Europe/Moscow' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`accept_orders` integer DEFAULT true NOT NULL,
	`greeting_text` text,
	`about_text` text,
	`contacts_text` text,
	`delivery_text` text,
	`payment_text` text,
	`busy_text` text,
	`reply_sla_text` text DEFAULT 'в течение нескольких часов' NOT NULL,
	`prepayment_percent` integer DEFAULT 50 NOT NULL,
	`min_lead_days` integer DEFAULT 2 NOT NULL,
	`max_advance_days` integer DEFAULT 60 NOT NULL,
	`default_daily_capacity` integer DEFAULT 5 NOT NULL,
	`payment_deadline_hours` integer DEFAULT 24 NOT NULL,
	`delivery_fee_minor` integer DEFAULT 0 NOT NULL,
	`digest_hour` integer DEFAULT 9 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `categories_tenant_idx` ON `categories` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `customers_tenant_tg_uq` ON `customers` (`tenant_id`,`telegram_id`);--> statement-breakpoint
CREATE INDEX `faq_tenant_idx` ON `faq_items` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `funnel_tenant_at_idx` ON `funnel_events` (`tenant_id`,`at`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_dedupe_key_unique` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `jobs_due_idx` ON `jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `attachments_order_idx` ON `order_attachments` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_events_order_idx` ON `order_events` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_tenant_number_uq` ON `orders` (`tenant_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idem_uq` ON `orders` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `orders_tenant_status_idx` ON `orders` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `orders_tenant_due_idx` ON `orders` (`tenant_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `options_product_idx` ON `product_options` (`product_id`);--> statement-breakpoint
CREATE INDEX `products_tenant_cat_idx` ON `products` (`tenant_id`,`category_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `relay_owner_msg_uq` ON `relay_messages` (`tenant_id`,`owner_chat_id`,`owner_message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_unique` ON `tenants` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_bot_id_unique` ON `tenants` (`bot_id`);