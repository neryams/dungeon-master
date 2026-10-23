# Third-party components

Dungeon Master's original application code is licensed under the MIT License
in `LICENSE`. This license does not replace the licenses of bundled dependencies,
rulebooks, or optional downloaded models.

## Desktop distribution

The desktop installer contains Electron and a separate Node.js runtime. Retain
Electron's license and Chromium third-party notices and Node's `LICENSE` with
their runtime distributions. Node packages in the packaged `node_modules` retain
their license files and package metadata. The packager records included packages
and declared licenses in `THIRD_PARTY_PACKAGES.json`; that inventory supplements,
and does not replace, their full license texts.

`markdown-it` is MIT-licensed; the browser build includes its license alongside
the bundled renderer module. Other dependencies retain their upstream notices.

## Dungeons & Dragons SRD

Bundled SRD material has its own attribution and Creative Commons licensing.
See `rules/` and the attribution and license files included with those sources.
Those materials are not relicensed under the application's MIT license.

## Optional narration

Phonon model weights are **not bundled**. Installation is optional and requires
explicit acknowledgement of the model's CC BY-NC 4.0 terms. Users who decline
can use the application without narration. Installation also requires access
to the model on Hugging Face. The access credential is used only for the current
download and is not saved by the application.

See `licenses/phonon/NOTICE.md`, `licenses/phonon/CC-BY-NC-4.0.txt`, and
`licenses/phonon/Apache-2.0.txt` for sources, pinned revisions, model restrictions,
voice licensing and runtime information. These notices are also copied into
the installed speech asset directory. Installed Python/runtime packages retain
their own license metadata.
