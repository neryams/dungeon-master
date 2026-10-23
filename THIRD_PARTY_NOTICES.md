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

## Optional narration

The macOS installer includes pinned Phonon 40M model weights and the native speech
runtime. This distribution of the model is for noncommercial purposes under
CC BY-NC 4.0. Its restrictions apply independently of the application's MIT
license. Explicit acknowledgement enables narration; users who decline can play
without it. End users do not need a Hugging Face account or token. Build-time
download credentials and personal settings are never bundled.

See `licenses/phonon/NOTICE.md`, `licenses/phonon/CC-BY-NC-4.0.txt`, and
`licenses/phonon/Apache-2.0.txt` for sources, pinned revisions, model restrictions,
voice licensing and runtime information. These notices are also copied into
the bundled speech resource directory. Native runtime licenses are retained
there. The separate source-development Python fallback retains installed package
license metadata and requires authorized upstream download access.
