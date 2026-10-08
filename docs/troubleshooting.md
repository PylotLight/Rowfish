# Troubleshooting

## Garbage characters after exiting dev (`^[[?62;22c`, `^[[9;1R`, `^[[11;rgb:...`)

On startup Electron probes terminal capabilities (device attributes, cursor position, background color). The terminal answers by injecting reply bytes into stdin; after `^C` your shell can read them as keystrokes. This affects many Electron apps.

`bun run dev` uses `scripts/dev.ts` to drain leftover input and restore the cursor when the child process exits. If you kill the process from another terminal, use `reset`. `bun run dev:bare` skips the wrapper.

## `bun run dev` fails with `Error: spawn ENOEXEC`

The `electron` npm package ships without its binary; an install script downloads it, and Bun does not run that script. Recovery:

```bash
rm -rf node_modules/electron/dist
bun install
```

Verify that `node_modules/electron/dist/version` matches `package.json`.

## Window appears opaque on macOS

The macOS window uses native vibrancy. Keep the `.shell` background in `src/renderer/src/index.css` translucent; an opaque full-window background covers the native blur.

## Preload changes not taking effect

`window.api` is generated at build time. `bun run dev` rebuilds main/preload on change and restarts Electron. If the renderer and bridge disagree, restart dev and check `src/main/ipc.ts` against `src/preload/index.ts`.
