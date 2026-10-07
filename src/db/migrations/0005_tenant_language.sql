-- Per-tenant interface language, independent of currency
ALTER TABLE `tenants` ADD `language` text DEFAULT 'ru' NOT NULL;
