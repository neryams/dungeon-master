# Third-party components

Dungeon Master's original application code is licensed under the MIT License
in `LICENSE`. This license does not replace the licenses of bundled dependencies,
rulebooks, or bundled models.

## Desktop distribution

The desktop installer contains Electron and a separate Node.js runtime. Retain
Electron's license and Chromium third-party notices and Node's `LICENSE` with
their runtime distributions. Node packages in the packaged `node_modules` retain
their license files and package metadata. The packager records included packages
and declared licenses in `THIRD_PARTY_PACKAGES.json`; that inventory supplements,
and does not replace, their full license texts.

`markdown-it` is MIT-licensed; the browser build includes its license alongside
the bundled renderer module. Other dependencies retain their upstream notices.
`isomorphic-git` (MIT) initializes campaign repositories without a system Git executable.

## Dungeons & Dragons SRD

Bundled SRD material has its own attribution and Creative Commons licensing.
See `rules/` and the attribution and license files included with those sources.
Those materials are not relicensed under the application's MIT license.

## Optional Gemini speech

Gemini speech is an optional hosted service enabled by the user with their own
Google AI API key. The installer contains no speech model weights, speech engine,
or voice assets. Review Google's current API terms and pricing before enabling it.
