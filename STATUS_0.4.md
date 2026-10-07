# Task 0.4: Bot runner and middleware

## Status: ✅ COMPLETED

## Acceptance Criteria
- [x] BotRunner class manages multiple tenant bots in one process
- [x] Bot factory creates configured Bot instances with tenant context
- [x] Tenant middleware loads full tenant data from database
- [x] Role middleware identifies superadmin/owner/customer
- [x] Session middleware loads/saves session from database with zod validation
- [x] Antispam middleware rate limits (20 msg/60s), blocks for 5 minutes
- [x] Funnel middleware tracks analytics events
- [x] Error middleware handles TelegramError and BLOCKED code
- [x] All middleware integrated into factory
- [x] Tests verify middleware behavior

## Files Created
- `src/bot/factory.ts` - Creates TenantBot instances with middleware chain
- `src/bot/context.ts` - BotContext and BotContextWithSession types
- `src/bot/runner.ts` - BotRunner class for multi-tenant bot management
- `src/bot/middleware/tenant.ts` - Loads tenant data from database
- `src/bot/middleware/role.ts` - Determines user role
- `src/bot/middleware/session.ts` - Session persistence with zod validation
- `src/bot/middleware/antispam.ts` - Rate limiting and spam protection
- `src/bot/middleware/funnel.ts` - Analytics event tracking
- `src/bot/middleware/errors.ts` - Error handling and TelegramError processing
- `tests/middleware.test.ts` - 7 tests covering middleware behavior

## Tests
```
✓ tests/middleware.test.ts (7 tests)
  ✓ session middleware > creates new session for new user
  ✓ role middleware > identifies superadmin
  ✓ role middleware > identifies owner
  ✓ role middleware > identifies customer
  ✓ antispam middleware > allows messages under limit
  ✓ antispam middleware > blocks messages over limit
  ✓ antispam middleware > skips antispam for owners
```

## Architecture

### Multi-tenant Bot Runner
- `BotRunner` manages Map of tenant bots
- Each tenant gets isolated Bot instance with @grammyjs/runner
- Bots start/stop independently, one failure doesn't affect others
- Bot tokens decrypted from database on startup

### Middleware Chain (order matters)
1. **Error middleware** - Wraps entire chain, catches all errors
2. **Tenant middleware** - Loads full tenant data from DB
3. **Role middleware** - Identifies user role (superadmin/owner/customer)
4. **Session middleware** - Loads session from DB, saves after processing
5. **Antispam middleware** - Rate limits customers (20 msg/60s)
6. **Funnel middleware** - Tracks analytics events, creates customer records

### Session Persistence
- Sessions stored in database, not memory
- zod validation on load (invalid sessions reset)
- Automatic save after each update
- Contains: cart, checkout draft, owner draft, payment, antispam state

### Antispam Protection
- 20 messages per 60-second window
- Blocks for 5 minutes after exceeding limit
- Owners and superadmins exempt
- State stored in session (survives bot restart)

### Error Handling
- TelegramError wraps all Telegram API errors
- BLOCKED errors logged, no message sent
- Other errors send generic error message to user
- Prevents bot crashes from propagating

## Validation
```bash
npm run lint    # ✅ Pass
npm run typecheck  # ✅ Pass
npm test        # ✅ 59 tests pass
npm run build   # ✅ Pass
```

## Next Steps
Task 0.4 is complete. Ready for task 0.5 (Job scheduler).
