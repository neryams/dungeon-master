# Optional Phonon narration

Dungeon Master application code is licensed under MIT. The following optional
assets and tools have separate licenses; MIT does not grant additional rights
to those components. The macOS installer includes Phonon weights for
noncommercial distribution and use under their separate license.

## Phonon 40M English

Publisher: Gradium. Model source:
https://huggingface.co/gradium/phonon-40m-en

Pinned revision: `cc738b7e4d182c2ba1bafb8062aa4846af000637`.

Model weights, tokenizer and default voice from that repository are provided
under Creative Commons Attribution-NonCommercial 4.0 International. The complete
license and its disclaimer are in `CC-BY-NC-4.0.txt`, also available at
https://creativecommons.org/licenses/by-nc/4.0/.

This license permits use and sharing of the licensed material for noncommercial
purposes under its terms. Noncommercial means not primarily intended for or
directed toward commercial advantage or monetary compensation. It does not mean
merely that the application is free. Commercial rights are not provided by this
application; contact the model's rights holder for separate permission.

The app includes the original pinned q8 weights without modifying them. Model
cards and upstream attribution are retained with the assets. Gradium's
model card credits Kyutai's Pocket TTS and Mimi as the underlying work. No
endorsement of Dungeon Master by these organizations is claimed.

## Easton and Zoey voice embeddings

Publisher: Gradium. Source: https://huggingface.co/gradium/phonon-voices

Pinned revision: `da6c9ec0d47be8df5c87c730a3aa97187f3229c3`.
Easton: `voices/LMDIYE0Oa377Qh6Z.safetensors`.
Zoey: `voices/NbpkqMVS3CJeq2j8.safetensors`.

The separate voice catalog lists Apache License 2.0 (`Apache-2.0.txt`). The app
copies the unchanged embedding files to friendly local filenames and creates a
two-voice selection catalog. The original downloaded catalog is retained. These
voice licenses do not remove the Phonon 40M model's noncommercial restriction.

## Runtime

The `ptts` runtime is a separate MIT OR Apache-2.0 project:
https://github.com/gradium-ai/xn-ptts. The macOS package includes a pinned native
runtime with its license notices. Speech runs locally using bundled assets.
Hugging Face access is needed only by maintainers downloading upstream assets,
or by source developers using the separate Python fallback.

The source-development fallback uses Astral's uv 0.13.5 (MIT OR Apache-2.0), downloaded from
https://github.com/astral-sh/uv/releases/tag/0.13.5. Its MIT license and copyright
notice are in `uv-LICENSE-MIT.txt`. The private CPython distribution retains its
license under `python/.../lib/python3.12/LICENSE.txt`; installed speech packages
retain their licenses in their `.dist-info` directories. The setup tool and
Python environment are not installed into global system locations.

The model license and runtime licenses provide their respective warranty
disclaimers. This notice summarizes component boundaries and does not replace
or expand any upstream license.
