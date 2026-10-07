# Node.js 26 Compatibility Issue

**Issue**: `better-sqlite3` doesn't support Node.js 26 yet due to V8 API changes.

**Solution**: Use Node.js 22 LTS (recommended) or Node.js 23.

## Install Node.js 22 LTS

### Using nvm
```bash
nvm install 22
nvm use 22
```

### Using Homebrew (macOS)
```bash
brew install node@22
brew link node@22
```

### Direct download
Download from https://nodejs.org/ (choose LTS version 22.x)

## Verify
```bash
node --version  # should show v22.x.x
npm install
```
