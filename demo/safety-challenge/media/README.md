# Synthetic voice scenarios — WAV only

Two fictional English calls, rendered locally with offline operating-system TTS:

- `synthetic-prosecutor-en.wav` — prosecutor impersonation
- `synthetic-delivery-en.wav` — registered mail impersonation

No MP4, original awareness recordings, real caller voices, names, or third-party audio are included. The code plays these WAVs and streams their **actual PCM** through the real-time ASR adapter when Meta is explicitly enabled. The JSON manifests contain offline ground-truth transcripts and timelines for testing; the runtime never reads the transcripts to fabricate ASR or risk results.

Regenerate with `node scripts/generate-tts-audio.mjs` (Linux needs offline `espeak` + `ffmpeg`; Windows uses System.Speech + `ffmpeg`; macOS uses `say` + `ffmpeg`). Generated synthetic voices remain subject to OS voice-engine redistribution terms.

Without a configured Meta key and explicit consent, WAV playback still works but no real STT/AI inference occurs. The local contract simulator is explicitly marked as **not real ASR** and uses placeholders, not the ground-truth script.
