# TGBOX

Node.js + TypeScript Telegram userbot (MTProto) built on mtcute.

## Requirements
- Node.js >= 18

## Setup
```bash
pnpm install
```

## Configure
Edit `.env.development` (and `.env.production` if needed):
- `API_ID` and `API_HASH` from <https://my.telegram.org/apps>
- `SESSION_PATH` for SQLite session storage
- `ALLOWED_CHAT_IDS` optional comma-separated list

## Development
```bash
pnpm dev
```

On first run, you will be prompted for phone, code, and password (2FA).
The session is persisted to the SQLite file in `SESSION_PATH`.

## Testing
```bash
pnpm test
```

## Production
```bash
pnpm build
pnpm start
```

## Env files
- .env.development
- .env.test
- .env.production

## Built-in commands
- `/ping` -> `pong`
- `/id` -> reply with current chat ID
- `hello*` -> `hi there`
