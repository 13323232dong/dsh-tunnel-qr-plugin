const ARTIFACTS = Object.freeze({
    'darwin/x64': Object.freeze({
        asset: 'cloudflared-darwin-amd64.tgz',
        sha256: 'f1727723c586500e2092368ae21871b3df7ddfd2cb097f22d81bee4a9c458bb4',
        executable: 'cloudflared',
        archive: 'tar-gzip',
        requiresX64Emulation: false,
    }),
    'darwin/arm64': Object.freeze({
        asset: 'cloudflared-darwin-arm64.tgz',
        sha256: '9042c2c5d8b2de78e60f313d5fb31b6c5c1cebde787a3caf1f2c9588084ac442',
        executable: 'cloudflared',
        archive: 'tar-gzip',
        requiresX64Emulation: false,
    }),
    'linux/x64': Object.freeze({
        asset: 'cloudflared-linux-amd64',
        sha256: 'fcfb02b575a52ca1af2e3267af4e1517bcdeb30ac48c834c69abaed3c0576ad2',
        executable: 'cloudflared',
        archive: 'raw',
        requiresX64Emulation: false,
    }),
    'linux/arm64': Object.freeze({
        asset: 'cloudflared-linux-arm64',
        sha256: '7747d94570fb390cf47dcb4f9555c193c6355cda9793f0d878d9049e5d6a7790',
        executable: 'cloudflared',
        archive: 'raw',
        requiresX64Emulation: false,
    }),
    'win32/x64': Object.freeze({
        asset: 'cloudflared-windows-amd64.exe',
        sha256: 'c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5',
        executable: 'cloudflared.exe',
        archive: 'raw',
        requiresX64Emulation: false,
    }),
    'win32/arm64': Object.freeze({
        asset: 'cloudflared-windows-amd64.exe',
        sha256: 'c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5',
        executable: 'cloudflared.exe',
        archive: 'raw',
        requiresX64Emulation: true,
    }),
});
/** Resolve only explicitly supported pairs; unknown pairs fail closed. */
export function resolveArtifact(platform, architecture) {
    const artifact = ARTIFACTS[`${platform}/${architecture}`];
    return artifact === undefined
        ? { ok: false, code: 'unsupported-platform', platform, architecture }
        : { ok: true, artifact };
}
//# sourceMappingURL=artifacts.js.map