# [swirl](https://x.com/swirlynews_)

Debian news bot for Twitter using Debian's RSS feeds and a Twitter/X reverse-engineered API.

## Usage

1. Install dependencies:

```bash
bun install
```

2. Get your twitter auth cookie by opening Twitter, then devtools, application, cookies, x.com and copy auth_token. Rename .env.example to .env and paste it there

3. Run the bot:

```bash
bun run src/index.js
```

This project was created using `bun init` in bun v1.2.10. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
