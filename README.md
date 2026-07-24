# wenlan-app

Desktop client for [Wenlan](https://github.com/7xuanlu/wenlan). Where Personal AI Memory Compounds.

Tauri 2 + React 19. Talks to the Wenlan daemon over HTTP at `localhost:7878`.

## Build

```bash
pnpm install
pnpm dev:all   # launches an isolated worktree daemon + Tauri app
```

`pnpm dev:all` is the supported development entry point. It keeps development
ports, data, process ownership, app identity, MCP sockets, and Remote Access
state separate from the installed production runtime.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).

Forked from [7xuanlu/origin](https://github.com/7xuanlu/origin) at SHA `1be677bd26417c5ff1b33b449bc1e2922568c3ca`.
