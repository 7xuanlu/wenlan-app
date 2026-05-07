# origin-app

Desktop client for [Origin](https://github.com/7xuanlu/origin). Where Personal AI Memory Compounds.

Tauri 2 + React 19. Talks to the origin daemon over HTTP at `localhost:7878`.

## Build

```bash
pnpm install
pnpm tauri dev   # requires running daemon on :7878
```

For full development sequence (daemon + Tauri app), see scripts/clean-dev.sh.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).

Forked from [7xuanlu/origin](https://github.com/7xuanlu/origin) at SHA `1be677bd26417c5ff1b33b449bc1e2922568c3ca`.
