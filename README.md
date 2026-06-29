# wenlan-app

Desktop client for [Wenlan](https://github.com/7xuanlu/wenlan). Where Personal AI Memory Compounds.

Tauri 2 + React 19. Talks to the Wenlan daemon over HTTP at `localhost:7878`.

## Build

```bash
pnpm install
pnpm tauri dev   # prepares sidecars, then launches the Tauri app
```

If you want a fresh daemon plus app sequence, use `pnpm dev:all`.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).

Forked from [7xuanlu/origin](https://github.com/7xuanlu/origin) at SHA `1be677bd26417c5ff1b33b449bc1e2922568c3ca`.
