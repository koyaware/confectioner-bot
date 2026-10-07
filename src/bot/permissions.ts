import { BotContextWithSession } from './context.js';

export function canAccessOwner(ctx: BotContextWithSession): boolean {
  return (
    ctx.role === 'owner' ||
    (ctx.role === 'superadmin' && ctx.tenant.ownerTelegramId === ctx.from?.id)
  );
}
