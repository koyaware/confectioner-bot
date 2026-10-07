# Task 0.3: TelegramPort interfaces

## Status: ✅ COMPLETED

## Acceptance Criteria
- [x] `TelegramPort` interface defines all bot messaging operations
- [x] `GrammyPort` implements the interface using grammY
- [x] `FakePort` implements the interface for testing with error injection
- [x] All three error codes (`RATE_LIMIT`, `BLOCKED`, `NETWORK`) are supported
- [x] Tests verify error handling and message recording

## Files Created
- `src/telegram/port.ts` - TelegramPort interface and TelegramError class
- `src/telegram/grammy-port.ts` - Production implementation using grammY
- `src/telegram/fake-port.ts` - Test implementation with error injection
- `tests/telegram-port.test.ts` - 24 tests covering all operations and error scenarios

## Tests
```
✓ tests/telegram-port.test.ts (24 tests)
  ✓ FakePort > records sendMessage calls
  ✓ FakePort > records editMessageText calls
  ✓ FakePort > records deleteMessage calls
  ✓ FakePort > records answerCallbackQuery calls
  ✓ FakePort > records sendPhoto calls
  ✓ FakePort > records copyMessage calls
  ✓ FakePort > injects RATE_LIMIT error
  ✓ FakePort > injects BLOCKED error
  ✓ FakePort > injects NETWORK error
  ✓ FakePort > clears call history
  ✓ FakePort > returns message IDs in sequence
  ✓ GrammyPort > constructs with token
  ✓ GrammyPort > sendMessage returns message id
  ✓ GrammyPort > editMessageText succeeds
  ✓ GrammyPort > deleteMessage succeeds
  ✓ GrammyPort > answerCallbackQuery succeeds
  ✓ GrammyPort > sendPhoto with buffer
  ✓ GrammyPort > sendPhoto with InputFile
  ✓ GrammyPort > sendPhoto with file_id
  ✓ GrammyPort > copyMessage succeeds
  ✓ GrammyPort > handles API errors as TelegramError
  ✓ GrammyPort > wraps non-GrammyError as TelegramError
  ✓ TelegramError > preserves error code
  ✓ TelegramError > has message
```

## Architecture
- Clean interface separation between bot logic and Telegram API
- Dependency injection pattern allows swapping implementations
- Test double pattern with FakePort enables testing without network
- All Telegram operations return Promise for async handling
- Error codes mapped from grammY errors to our domain errors

## Next Steps
Task 0.3 is complete. Ready for task 0.4 (Bot runner and middleware).
