-- Per-order currency snapshot (tech.md v1.40): sums of old orders keep
-- the symbol that was current at creation instead of the tenant's new one.
ALTER TABLE orders ADD COLUMN currency TEXT NOT NULL DEFAULT '₽';
UPDATE orders SET currency = (SELECT currency FROM tenants WHERE tenants.id = orders.tenant_id);
