# Node.js 26 Compatibility Issue

## Problem

Node.js 26.8.1 is currently installed, but `better-sqlite3` doesn't support Node.js 26 yet due to V8 API breaking changes.

## Root Cause

- Node.js 26 changed V8 APIs (`GetPrototype` → `GetPrototypeV2`, removed `Context.GetIsolate()`, etc.)
- `better-sqlite3` v11.7.0 (latest) hasn't been updated for these changes
- No prebuilt binaries exist for Node.js 26 on darwin-arm64

## Required Solution

**Install Node.js 22 LTS** (recommended by the spec: "Node.js LTS (>=22)")

### Option 1: Using nvm (recommended)
```bash
# Install nvm if not already installed
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Install Node.js 22 LTS
nvm install 22
nvm use 22
nvm alias default 22
```

### Option 2: Using Homebrew (macOS)
```bash
brew unlink node
brew install node@22
brew link --force node@22
```

### Option 3: Direct download
Download from https://nodejs.org/ (choose LTS version 22.x)

## Verification

After switching to Node.js 22:
```bash
node --version  # should show v22.x.x
rm -rf node_modules package-lock.json
npm install
npm test
npm run build
```

## Why Node.js 26?

Node.js 26 is not LTS (Long Term Support). The current LTS versions are:
- Node.js 22 LTS (recommended)
- Node.js 20 LTS (also supported)

The project spec requires "Node.js LTS (>=22)", which means Node.js 22 LTS is the target.

## Status

Task 0.1 cannot be completed on Node.js 26. The project requires Node.js 22 LTS to proceed with SQLite integration.
