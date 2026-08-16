# DSH Tunnel QR Plugin

Standalone DeepSeek Harness Web plugin that adds a right-bottom `二维码` button for reopening the public tunnel QR code.

## Features

- fixed right-bottom button with a mobile-safe offset;
- modal QR viewer with close button, backdrop click, and Escape support;
- plugin-owned `/dsh-public-qr.png` route with `GET` and `HEAD` support;
- bundle patch so installing the package can activate both Host and client halves.

The QR image is the deployment QR generated for the configured public tunnel. Regenerate and replace `assets/dsh-public-qr.png` when the tunnel URL changes.

## Install

From a DSH workspace/profile, install this package through the normal plugin workflow:

```sh
dsh plugin --profile web add https://github.com/13323232dong/dsh-tunnel-qr-plugin.git
```

Restart the Web profile after installation. The package's `dsh.bundle` patch mounts the plugin and its `dsh.client` declaration loads the browser half.

## Development

This repository contains the source and built client artifact. In the upstream DSH workspace, run:

```sh
pnpm exec tsc -b tsconfig.json
pnpm run bundle
```

The plugin requires the DSH Host Webserver and client runtime packages supplied by the host profile.
