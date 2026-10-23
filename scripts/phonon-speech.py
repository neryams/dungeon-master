#!/usr/bin/env python3
"""Private newline-JSON Phonon sidecar and one-time asset preparer."""

from __future__ import annotations

import argparse
import base64
import contextlib
import io
import json
import os
import sys
import wave
from pathlib import Path

MODEL_REPO = "gradium/phonon-40m-en"
MODEL_REVISION = "cc738b7e4d182c2ba1bafb8062aa4846af000637"
VOICE_REPO = "gradium/phonon-voices"
VOICE_REVISION = "da6c9ec0d47be8df5c87c730a3aa97187f3229c3"
VOICE_FILES = {
    "Easton": ("LMDIYE0Oa377Qh6Z", "LMDIYE0Oa377Qh6Z.safetensors"),
    "Zoey": ("NbpkqMVS3CJeq2j8", "NbpkqMVS3CJeq2j8.safetensors"),
}
MAX_TEXT_LENGTH = 2_000
MAX_AUDIO_BYTES = 10 * 1024 * 1024


def prepare(home: Path) -> None:
    # Use the Hub's supported local authentication API. Never print or persist the token.
    from huggingface_hub import HfApi, hf_hub_download, get_token

    token = get_token()
    if not token:
        raise RuntimeError("Hugging Face login is unavailable")

    model_dir = home / "model"
    voices_dir = home / "voices"
    model_dir.mkdir(parents=True, exist_ok=True)
    voices_dir.mkdir(parents=True, exist_ok=True)

    api = HfApi()
    info = api.model_info(MODEL_REPO, revision=MODEL_REVISION, token=token)
    if info.sha != MODEL_REVISION:
        raise RuntimeError("Pinned Phonon model revision could not be verified")
    for filename in (
        "README.md",
        "config.json",
        "tokenizer.json",
        "model.q8.gguf",
        "default-voice.safetensors",
    ):
        hf_hub_download(
            repo_id=MODEL_REPO,
            filename=filename,
            revision=MODEL_REVISION,
            token=token,
            local_dir=model_dir,
        )

    catalog_info = api.model_info(VOICE_REPO, revision=VOICE_REVISION, token=token)
    catalog_revision = catalog_info.sha
    if catalog_revision != VOICE_REVISION:
        raise RuntimeError("Pinned Phonon voice catalog revision could not be verified")
    catalog_path = hf_hub_download(
        repo_id=VOICE_REPO,
        filename="voices.jsonl",
        revision=catalog_revision,
        token=token,
        local_dir=voices_dir,
    )
    selected = {}
    with open(catalog_path, "r", encoding="utf-8") as catalog:
        for line in catalog:
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get("name") in VOICE_FILES:
                selected[entry["name"]] = entry

    entries = []
    for name, (voice_id, filename) in VOICE_FILES.items():
        entry = selected.get(name)
        if not entry or entry.get("voice_id") != voice_id:
            raise RuntimeError("Required voice was not present in the pinned voice catalog")
        target_name = f"{name}.safetensors"
        hf_hub_download(
            repo_id=VOICE_REPO,
            filename=entry["filename"],
            revision=catalog_revision,
            token=token,
            local_dir=voices_dir,
        )
        source = voices_dir / entry["filename"]
        target = voices_dir / target_name
        if source.resolve() != target.resolve():
            target.write_bytes(source.read_bytes())
        entries.append({"name": name, "filename": target_name})

    (voices_dir / "selected-voices.jsonl").write_text(
        "".join(json.dumps(entry, separators=(",", ":")) + "\n" for entry in entries),
        encoding="utf-8",
    )
    (home / "speech-assets.json").write_text(
        json.dumps(
            {"model_repo": MODEL_REPO, "model_revision": MODEL_REVISION,
            "voice_repo": VOICE_REPO, "voice_revision": catalog_revision},
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    print("Phonon model and Easton/Zoey voices are ready.", flush=True)


def serve(home: Path) -> None:
    # Keep all library output off stdout, which is reserved for protocol JSON.
    with contextlib.redirect_stdout(sys.stderr), contextlib.redirect_stderr(sys.stderr):
        import numpy as np
        import ptts

        ptts.set_num_threads(4)
        tts = ptts.TTS(
            str(home / "model"),
            lang="en",
            device="cpu",
            quant="q8",
            voice="Easton",
            voice_catalog=str(home / "voices" / "selected-voices.jsonl"),
            seed=42,
        )

    def respond(value: dict) -> None:
        sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
        sys.stdout.flush()

    respond({"type": "ready"})
    for raw_line in sys.stdin:
        request_id = None
        try:
            if len(raw_line.encode("utf-8")) > MAX_TEXT_LENGTH * 6:
                raise ValueError("invalid request")
            request = json.loads(raw_line)
            request_id = request.get("id")
            text = request.get("text")
            voice = request.get("voice")
            if (not isinstance(request_id, str) or len(request_id) > 64
                    or not isinstance(text, str) or not text.strip()
                    or len(text) > MAX_TEXT_LENGTH or voice not in VOICE_FILES):
                raise ValueError("invalid request")

            output = io.BytesIO()
            sample_count = 0
            with contextlib.redirect_stdout(sys.stderr), contextlib.redirect_stderr(sys.stderr):
                with wave.open(output, "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(tts.sample_rate)
                    with tts.stream(text, voice=voice, seed=42) as chunks:
                        for chunk in chunks:
                            pcm = np.asarray(chunk, dtype=np.float32)
                            sample_count += int(pcm.size)
                            if 44 + sample_count * 2 > MAX_AUDIO_BYTES:
                                raise ValueError("audio limit exceeded")
                            pcm16 = (np.clip(pcm, -1.0, 1.0) * 32767.0).astype("<i2", copy=False)
                            wav.writeframesraw(pcm16.tobytes())
                    wav.writeframes(b"")
            audio = output.getvalue()
            if sample_count == 0 or len(audio) > MAX_AUDIO_BYTES:
                raise ValueError("empty or oversized audio")
            respond({"id": request_id, "ok": True, "audio": base64.b64encode(audio).decode("ascii")})
        except Exception:
            # Do not echo the narration, exception text, credential state, or local paths.
            if request_id is not None and isinstance(request_id, str):
                respond({"id": request_id, "ok": False, "error": "synthesis_failed"})


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--prepare", action="store_true")
    mode.add_argument("--serve", action="store_true")
    parser.add_argument("--home", required=True)
    args = parser.parse_args()
    home = Path(args.home).expanduser().resolve()
    try:
        home.mkdir(parents=True, exist_ok=True)
        if args.prepare:
            prepare(home)
        else:
            serve(home)
        return 0
    except Exception as error:
        category = "Hugging Face access or download failed" if args.prepare else "Phonon speech engine failed to start"
        # Keep diagnostics generic; library exceptions can include absolute paths or request data.
        print(category, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
