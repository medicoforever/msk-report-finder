import type { AudioAttachment } from "../types";

const TARGET_SAMPLE_RATE = 16000;

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function encodeMonoWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function downsampleToMono16k(audioBuffer: AudioBuffer): {
  samples: Float32Array;
  durationSec: number;
} {
  const numChannels = audioBuffer.numberOfChannels;
  const len = audioBuffer.length;
  const mono = new Float32Array(len);
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      mono[i] += channelData[i] / numChannels;
    }
  }

  const srcRate = audioBuffer.sampleRate;
  if (srcRate === TARGET_SAMPLE_RATE) {
    return { samples: mono, durationSec: audioBuffer.duration };
  }

  const ratio = srcRate / TARGET_SAMPLE_RATE;
  const newLen = Math.max(1, Math.round(len / ratio));
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(len, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += mono[j];
      count++;
    }
    out[i] = count > 0 ? sum / count : mono[Math.min(start, len - 1)];
  }
  return { samples: out, durationSec: audioBuffer.duration };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = typeof reader.result === "string" ? reader.result : "";
      const comma = res.indexOf(",");
      if (comma >= 0) {
        resolve(res.slice(comma + 1));
      } else {
        reject(new Error("Failed to encode audio as base64."));
      }
    };
    reader.onerror = () => reject(new Error("FileReader failed on audio blob."));
    reader.readAsDataURL(blob);
  });
}

export function normalizeAudioMimeType(rawMime: string, filename?: string): string {
  const base = rawMime.split(";")[0].trim().toLowerCase();
  if (base === "audio/x-wav" || base === "audio/wave") return "audio/wav";
  if (base === "audio/x-m4a" || base === "audio/mp4") return "audio/m4a";
  if (
    base &&
    [
      "audio/wav",
      "audio/mp3",
      "audio/mpeg",
      "audio/aiff",
      "audio/aac",
      "audio/ogg",
      "audio/flac",
      "audio/m4a",
      "audio/opus",
      "audio/webm",
    ].includes(base)
  ) {
    return base;
  }
  const ext = (filename ?? "").split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    wav: "audio/wav",
    mp3: "audio/mp3",
    mpeg: "audio/mpeg",
    ogg: "audio/ogg",
    webm: "audio/webm",
    m4a: "audio/m4a",
    aac: "audio/aac",
    flac: "audio/flac",
    opus: "audio/opus",
    aiff: "audio/aiff",
  };
  return (ext && map[ext]) || "audio/wav";
}

export async function prepareAudioAttachment(
  blob: Blob,
  filename: string
): Promise<AudioAttachment> {
  // Prefer transcoding recorded/uploaded browser audio to compact 16kHz mono WAV for universal gemini-decision-1 compatibility
  try {
    const arrayBuf = await blob.arrayBuffer();
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    try {
      const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
      const { samples, durationSec } = downsampleToMono16k(decoded);
      const wavBlob = encodeMonoWav(samples, TARGET_SAMPLE_RATE);
      const base64 = await blobToBase64(wavBlob);
      const previewUrl = URL.createObjectURL(wavBlob);
      return {
        base64,
        mimeType: "audio/wav",
        durationSec,
        sizeBytes: wavBlob.size,
        filename: filename.replace(/\.[^.]+$/, "") + ".wav",
        previewUrl,
      };
    } finally {
      await ctx.close().catch(() => undefined);
    }
  } catch {
    // Fallback to original blob with clean MIME type
    const mimeType = normalizeAudioMimeType(blob.type, filename);
    const base64 = await blobToBase64(blob);
    const previewUrl = URL.createObjectURL(blob);
    return {
      base64,
      mimeType,
      durationSec: 0,
      sizeBytes: blob.size,
      filename,
      previewUrl,
    };
  }
}

export interface MicRecorderHandle {
  stop: () => Promise<AudioAttachment>;
  cancel: () => void;
  getLevel: () => number;
}

export async function startMicRecording(): Promise<MicRecorderHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone recording is not supported in this browser.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const freqData = new Uint8Array(analyser.frequencyBinCount);

  const preferredMime = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ].find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));

  const recorder = preferredMime
    ? new MediaRecorder(stream, { mimeType: preferredMime })
    : new MediaRecorder(stream);

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };

  recorder.start(150);

  const cleanup = () => {
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => undefined);
  };

  return {
    getLevel: () => {
      analyser.getByteFrequencyData(freqData);
      let sum = 0;
      for (let i = 0; i < freqData.length; i++) sum += freqData[i];
      return Math.min(1, sum / (freqData.length * 110));
    },
    cancel: () => {
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // ignore
      }
      cleanup();
    },
    stop: () =>
      new Promise<AudioAttachment>((resolve, reject) => {
        recorder.onstop = async () => {
          try {
            const mime = recorder.mimeType || preferredMime || "audio/webm";
            const rawBlob = new Blob(chunks, { type: mime });
            cleanup();
            if (rawBlob.size === 0) {
              reject(new Error("Recorded audio was empty. Please speak clearly and try again."));
              return;
            }
            const attachment = await prepareAudioAttachment(rawBlob, "dictation-recording.wav");
            resolve(attachment);
          } catch (err) {
            cleanup();
            reject(err);
          }
        };
        recorder.onerror = () => {
          cleanup();
          reject(new Error("Microphone recording failed."));
        };
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      }),
  };
}
