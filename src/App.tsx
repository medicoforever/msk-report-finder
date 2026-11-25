import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Archive,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileAudio,
  FileText,
  FolderSearch,
  KeyRound,
  Lock,
  Mic,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Unlock,
  Upload,
  X,
} from "lucide-react";
import type {
  AudioAttachment,
  DecisionSearchResult,
  InputMode,
  ReportRecord,
  ReportsCorpus,
  SearchStrategy,
} from "./types";
import {
  prepareAudioAttachment,
  startMicRecording,
  type MicRecorderHandle,
} from "./services/audioRecorder";
import {
  findTopReportsWithDecision1,
  verifyGeminiApiKey,
} from "./services/geminiDecision";
import { downloadSingleDocx, downloadTop5Zip } from "./services/docxExport";

const API_KEY_STORAGE_KEY = "msk_finder_gemini_api_key";
const API_KEY_VERIFIED_STORAGE_KEY = "msk_finder_gemini_api_key_verified";

const SAMPLE_QUERIES = [
  "Right shoulder supraspinatus partial thickness tear with subacromial impingement and AC arthropathy",
  "L5 bilateral spondylolysis with grade 1 anterolisthesis and L4-5 nerve root indentation",
  "Left knee acute complete ACL tear with pivot shift bone contusion and lateral meniscal tear",
  "Distal femur osteosarcoma with soft tissue mass and knee joint effusion",
  "CT right ankle trimalleolar fracture Weber B with tibiotalar subluxation",
  "Bilateral ankle inflammatory enthesitis with peroneal tenosynovitis",
];

const REGION_LABELS: Record<string, string> = {
  shoulder: "Shoulder",
  knee: "Knee",
  lumbar_spine: "Lumbar Spine",
  cervical_spine: "Cervical Spine",
  dorsal_spine: "Dorsal Spine",
  ankle_foot: "Ankle & Foot",
  wrist_hand: "Wrist & Hand",
  hip_pelvis: "Hip & Pelvis",
  elbow_arm: "Elbow & Arm",
  thigh_leg: "Thigh & Leg",
  thorax_chest: "Thorax & Chest",
  brachial_nerves: "Brachial Plexus / Nerves",
  brain_head_neck: "Brain / Orbits / PNS",
  whole_body: "Whole Body",
  other: "Other",
};

function maskApiKey(key: string): string {
  const k = key.trim();
  if (k.length <= 8) return "••••";
  return `${k.slice(0, 6)}••••${k.slice(-4)}`;
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

export default function App() {
  // Corpus state
  const [corpus, setCorpus] = useState<ReportRecord[]>([]);
  const [corpusLoading, setCorpusLoading] = useState(true);
  const [corpusError, setCorpusError] = useState<string | null>(null);

  // API Key Gate state
  const [savedApiKey, setSavedApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem(API_KEY_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [keyVerified, setKeyVerified] = useState<boolean>(() => {
    try {
      return localStorage.getItem(API_KEY_VERIFIED_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [keyInput, setKeyInput] = useState(savedApiKey);
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [verifyingKey, setVerifyingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  // Navigation tab
  const [activeTab, setActiveTab] = useState<"finder" | "library">("finder");

  // Input studio state
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [textQuery, setTextQuery] = useState("");
  const [audioNote, setAudioNote] = useState("");
  const [strategy, setStrategy] = useState<SearchStrategy>("cascade");
  const [audioAttachment, setAudioAttachment] = useState<AudioAttachment | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const recorderRef = useRef<MicRecorderHandle | null>(null);
  const timerRef = useRef<number | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Search state
  const [searching, setSearching] = useState(false);
  const [searchPhase, setSearchPhase] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [result, setResult] = useState<DecisionSearchResult | null>(null);

  // Preview / Download / Library state
  const [previewReport, setPreviewReport] = useState<ReportRecord | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [libFilterText, setLibFilterText] = useState("");
  const [libRegionFilter, setLibRegionFilter] = useState<string>("all");
  const [libModalityFilter, setLibModalityFilter] = useState<string>("all");

  const isUnlocked = savedApiKey.trim().length > 0;

  useEffect(() => {
    let active = true;
    fetch("./data/reports-index.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ReportsCorpus>;
      })
      .then((data) => {
        if (!active) return;
        setCorpus(data.reports ?? []);
        setCorpusLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setCorpusError(
          `Failed to load segregated MSK report index: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        setCorpusLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current);
      recorderRef.current?.cancel();
    };
  }, []);

  const handleSaveAndVerifyKey = async (verifyFirst: boolean) => {
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setKeyError("Please paste your Gemini API key before saving.");
      return;
    }
    setKeyError(null);
    if (verifyFirst) {
      setVerifyingKey(true);
      try {
        await verifyGeminiApiKey(trimmed);
        localStorage.setItem(API_KEY_STORAGE_KEY, trimmed);
        localStorage.setItem(API_KEY_VERIFIED_STORAGE_KEY, "true");
        setSavedApiKey(trimmed);
        setKeyVerified(true);
        setKeyModalOpen(false);
      } catch (err) {
        setKeyError(
          `Key verification failed with gemini-decision-1: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      } finally {
        setVerifyingKey(false);
      }
    } else {
      localStorage.setItem(API_KEY_STORAGE_KEY, trimmed);
      localStorage.setItem(API_KEY_VERIFIED_STORAGE_KEY, "false");
      setSavedApiKey(trimmed);
      setKeyVerified(false);
      setKeyModalOpen(false);
    }
  };

  const handleClearKey = () => {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    localStorage.removeItem(API_KEY_VERIFIED_STORAGE_KEY);
    setSavedApiKey("");
    setKeyInput("");
    setKeyVerified(false);
    setResult(null);
    setKeyError(null);
    setKeyModalOpen(false);
  };

  const stopRecordingTimers = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (levelRafRef.current) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
  };

  const handleStartRecording = async () => {
    setSearchError(null);
    try {
      const handle = await startMicRecording();
      recorderRef.current = handle;
      setIsRecording(true);
      setRecordSeconds(0);
      if (audioAttachment?.previewUrl) {
        URL.revokeObjectURL(audioAttachment.previewUrl);
      }
      setAudioAttachment(null);

      timerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);

      const tickLevel = () => {
        if (!recorderRef.current) return;
        setAudioLevel(recorderRef.current.getLevel());
        levelRafRef.current = requestAnimationFrame(tickLevel);
      };
      levelRafRef.current = requestAnimationFrame(tickLevel);
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : "Could not access microphone."
      );
    }
  };

  const handleStopRecording = async () => {
    stopRecordingTimers();
    setIsRecording(false);
    setAudioLevel(0);
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (!rec) return;
    try {
      const att = await rec.stop();
      setAudioAttachment(att);
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : "Failed to finalize audio."
      );
    }
  };

  const handleAudioFileChange = async (
    ev: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setSearchError(null);
    try {
      if (audioAttachment?.previewUrl) {
        URL.revokeObjectURL(audioAttachment.previewUrl);
      }
      const att = await prepareAudioAttachment(file, file.name);
      setAudioAttachment(att);
      setInputMode("audio");
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : "Could not process audio file."
      );
    }
  };

  const clearAudio = () => {
    if (audioAttachment?.previewUrl) {
      URL.revokeObjectURL(audioAttachment.previewUrl);
    }
    setAudioAttachment(null);
  };

  const handleSearch = async () => {
    if (!isUnlocked) {
      setKeyModalOpen(true);
      return;
    }
    if (corpus.length === 0) {
      setSearchError("Report corpus is still loading. Please wait a moment.");
      return;
    }
    if (inputMode === "text" && !textQuery.trim()) {
      setSearchError("Enter clinical findings, scan region, or keywords to search.");
      return;
    }
    if (inputMode === "audio" && !audioAttachment) {
      setSearchError("Record dictation or upload an audio file first.");
      return;
    }

    setSearchError(null);
    setSearching(true);
    setSearchPhase("Initializing gemini-decision-1 (v1beta Decisions API)...");

    try {
      const res = await findTopReportsWithDecision1({
        apiKey: savedApiKey,
        corpus,
        textQuery: inputMode === "text" ? textQuery : audioNote,
        audio: inputMode === "audio" ? audioAttachment : null,
        strategy,
        onPhase: setSearchPhase,
      });
      setResult(res);
    } catch (err) {
      setSearchError(
        err instanceof Error
          ? err.message
          : "Gemini Decision 1 request failed. Check your API key and network."
      );
    } finally {
      setSearching(false);
      setSearchPhase("");
    }
  };

  const handleDownloadOne = async (filename: string) => {
    setDownloadingFile(filename);
    try {
      await downloadSingleDocx(filename);
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : `Download failed for ${filename}`
      );
    } finally {
      setDownloadingFile(null);
    }
  };

  const handleDownloadZip = async () => {
    if (!result?.top5.length) return;
    setZipping(true);
    try {
      await downloadTop5Zip(result.top5);
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : "Failed to bundle Top 5 ZIP."
      );
    } finally {
      setZipping(false);
    }
  };

  const handleCopyReport = async (report: ReportRecord) => {
    try {
      await navigator.clipboard.writeText(report.fullText);
      setCopiedId(report.id);
      setTimeout(() => setCopiedId((prev) => (prev === report.id ? null : prev)), 1800);
    } catch {
      // fallback ignored
    }
  };

  const regionStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of corpus) {
      const reg = r.regions[0] || "other";
      counts[reg] = (counts[reg] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [corpus]);

  const filteredLibrary = useMemo(() => {
    const q = libFilterText.trim().toLowerCase();
    return corpus.filter((r) => {
      if (libModalityFilter !== "all" && r.modality !== libModalityFilter) return false;
      if (libRegionFilter !== "all" && !r.regions.includes(libRegionFilter)) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.clinicalProfile.toLowerCase().includes(q) ||
        r.impression.toLowerCase().includes(q) ||
        r.filename.toLowerCase().includes(q)
      );
    });
  }, [corpus, libFilterText, libRegionFilter, libModalityFilter]);

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-icon">
              <Activity size={20} />
            </div>
            <div>
              <div className="brand-title">
                MSK Report Finder
                <span className="model-badge">gemini-decision-1</span>
              </div>
              <div className="brand-subtitle">
                {corpusLoading
                  ? "Loading segregated MSK library..."
                  : `${corpus.length} segregated .docx radiology formats · Text & Audio Decisions`}
              </div>
            </div>
          </div>

          <div className="topbar-actions">
            <nav className="nav-tabs" aria-label="Workspace views">
              <button
                type="button"
                className={`nav-tab ${activeTab === "finder" ? "active" : ""}`}
                onClick={() => setActiveTab("finder")}
              >
                <Search size={15} />
                <span>Top 5 Finder</span>
              </button>
              <button
                type="button"
                className={`nav-tab ${activeTab === "library" ? "active" : ""}`}
                onClick={() => setActiveTab("library")}
              >
                <FolderSearch size={15} />
                <span>All {corpus.length || ""} .docx</span>
              </button>
            </nav>

            <button
              type="button"
              className={`key-pill ${isUnlocked ? "unlocked" : "locked"}`}
              onClick={() => {
                setKeyInput(savedApiKey);
                setKeyError(null);
                setKeyModalOpen(true);
              }}
            >
              {isUnlocked ? <Unlock size={14} /> : <Lock size={14} />}
              <span>
                {isUnlocked
                  ? `${maskApiKey(savedApiKey)}${keyVerified ? " · Verified" : ""}`
                  : "Set Gemini API Key"}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="main-container">
        {corpusError && <div className="alert error">{corpusError}</div>}

        {/* API KEY GATE when locked */}
        {!isUnlocked ? (
          <section className="gate-card">
            <div className="gate-badge">
              <KeyRound size={18} />
              <span>Gemini API Key Required</span>
            </div>
            <h1>Unlock MSK Report Finder</h1>
            <p className="gate-desc">
              This app runs <strong>gemini-decision-1</strong> (<code>v1beta</code> Decisions API)
              directly in your browser to evaluate your text or voice dictation and fetch the{" "}
              <strong>Top 5 matching .docx</strong> templates from{" "}
              <strong>{corpus.length || 671} segregated MSK reports</strong>. Save your Gemini API
              key below to enable search and audio retrieval.
            </p>

            <div className="gate-form">
              <label htmlFor="gate-api-key">Gemini API Key</label>
              <div className="gate-input-row">
                <input
                  id="gate-api-key"
                  type="password"
                  placeholder="AIzaSy..."
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveAndVerifyKey(true);
                  }}
                />
                <button
                  type="button"
                  className="btn primary"
                  disabled={verifyingKey}
                  onClick={() => handleSaveAndVerifyKey(true)}
                >
                  <ShieldCheck size={16} />
                  <span>{verifyingKey ? "Verifying..." : "Verify & Unlock App"}</span>
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={verifyingKey}
                  onClick={() => handleSaveAndVerifyKey(false)}
                >
                  Save Key
                </button>
              </div>
              {keyError && <div className="alert error">{keyError}</div>}

              <div className="gate-hints">
                <span>
                  Stored strictly in your browser&apos;s <code>localStorage</code> and sent only to{" "}
                  <code>generativelanguage.googleapis.com</code>.
                </span>
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="link-inline"
                >
                  Get a Gemini API key in Google AI Studio <ExternalLink size={13} />
                </a>
              </div>
            </div>
          </section>
        ) : activeTab === "finder" ? (
          <>
            {/* INPUT STUDIO */}
            <section className="studio-card">
              <div className="studio-header">
                <div className="mode-toggle" role="tablist" aria-label="Input modality">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={inputMode === "text"}
                    className={`mode-btn ${inputMode === "text" ? "active" : ""}`}
                    onClick={() => setInputMode("text")}
                  >
                    <FileText size={16} />
                    <span>Text Query</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={inputMode === "audio"}
                    className={`mode-btn ${inputMode === "audio" ? "active" : ""}`}
                    onClick={() => setInputMode("audio")}
                  >
                    <FileAudio size={16} />
                    <span>Audio / Voice</span>
                  </button>
                </div>

                <div className="strategy-picker">
                  <Settings2 size={14} />
                  <label htmlFor="strategy-select">Decision Mode:</label>
                  <select
                    id="strategy-select"
                    value={strategy}
                    onChange={(e) => setStrategy(e.target.value as SearchStrategy)}
                  >
                    <option value="cascade">
                      Smart 2-Stage Cascade (~5k tokens · Free Tier friendly)
                    </option>
                    <option value="exhaustive">
                      Full {corpus.length || 671}-Report Single-Pass Scan (~30k tokens)
                    </option>
                  </select>
                </div>
              </div>

              {inputMode === "text" ? (
                <div className="text-input-area">
                  <textarea
                    rows={3}
                    placeholder="Describe the MSK scan, side, clinical history, or findings (e.g., 'MRI right shoulder partial thickness supraspinatus tear with subacromial impingement' or 'L5 bilateral spondylolysis with anterolisthesis')..."
                    value={textQuery}
                    onChange={(e) => setTextQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        handleSearch();
                      }
                    }}
                  />
                  <div className="sample-chips">
                    <span className="chips-label">Quick examples:</span>
                    {SAMPLE_QUERIES.map((q) => (
                      <button
                        key={q}
                        type="button"
                        className="chip-btn"
                        onClick={() => setTextQuery(q)}
                      >
                        {q.length > 52 ? `${q.slice(0, 52)}...` : q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="audio-input-area">
                  <div className="audio-controls-grid">
                    {/* Microphone Recorder */}
                    <div className="audio-box">
                      <div className="audio-box-title">
                        <Mic size={16} />
                        <span>Live Voice Dictation</span>
                      </div>
                      <p className="audio-box-sub">
                        Speak naturally — <code>gemini-decision-1</code> evaluates your raw audio
                        directly without intermediate transcription loss.
                      </p>

                      {!isRecording ? (
                        <button
                          type="button"
                          className="btn record-btn"
                          onClick={handleStartRecording}
                        >
                          <Mic size={16} />
                          <span>Start Microphone Recording</span>
                        </button>
                      ) : (
                        <div className="recording-live">
                          <div className="rec-indicator">
                            <span className="pulse-dot" />
                            <span>Recording {formatDuration(recordSeconds)}</span>
                          </div>
                          <div className="level-bars" aria-hidden="true">
                            {[0.3, 0.55, 0.8, 1.0, 0.75, 0.45, 0.9, 0.6].map((mult, idx) => (
                              <span
                                key={idx}
                                className="level-bar"
                                style={{
                                  height: `${Math.max(
                                    18,
                                    Math.min(100, Math.round(audioLevel * mult * 120 + 18))
                                  )}%`,
                                }}
                              />
                            ))}
                          </div>
                          <button
                            type="button"
                            className="btn stop-btn"
                            onClick={handleStopRecording}
                          >
                            <Square size={14} />
                            <span>Stop &amp; Attach WAV</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Upload Audio File */}
                    <div className="audio-box">
                      <div className="audio-box-title">
                        <Upload size={16} />
                        <span>Upload Audio File</span>
                      </div>
                      <p className="audio-box-sub">
                        Supports WAV, MP3, M4A, WEBM, OGG, AAC, and FLAC recordings.
                      </p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg,.flac,.aac"
                        className="hidden-input"
                        onChange={handleAudioFileChange}
                      />
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload size={16} />
                        <span>Choose Audio File</span>
                      </button>
                    </div>
                  </div>

                  {audioAttachment && (
                    <div className="attached-audio">
                      <div className="attached-meta">
                        <FileAudio size={18} />
                        <div>
                          <div className="attached-name">{audioAttachment.filename}</div>
                          <div className="attached-sub">
                            {audioAttachment.mimeType} ·{" "}
                            {audioAttachment.durationSec > 0
                              ? `${audioAttachment.durationSec.toFixed(1)}s · `
                              : ""}
                            {(audioAttachment.sizeBytes / 1024).toFixed(1)} KB
                          </div>
                        </div>
                      </div>
                      <audio controls src={audioAttachment.previewUrl} className="audio-player" />
                      <button
                        type="button"
                        className="btn ghost icon-only"
                        onClick={clearAudio}
                        title="Remove attached audio"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}

                  <div className="optional-note">
                    <input
                      type="text"
                      placeholder="Optional extra text note alongside audio (e.g., 'CT only' or 'Left side')..."
                      value={audioNote}
                      onChange={(e) => setAudioNote(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div className="studio-footer">
                <div className="footer-hint">
                  <Sparkles size={14} />
                  <span>
                    Evaluated by <code>gemini-decision-1</code> (0 output tokens · calibrated rubric
                    probabilities)
                  </span>
                </div>
                <button
                  type="button"
                  className="btn primary run-btn"
                  disabled={searching || corpusLoading}
                  onClick={handleSearch}
                >
                  <Search size={16} />
                  <span>{searching ? "Scoring with Gemini Decision 1..." : "Fetch Top 5 .docx"}</span>
                </button>
              </div>

              {searching && (
                <div className="progress-banner">
                  <span className="spinner" />
                  <span>{searchPhase}</span>
                </div>
              )}
              {searchError && <div className="alert error">{searchError}</div>}
            </section>

            {/* RESULTS SECTION */}
            {result && (
              <section className="results-section">
                {/* Telemetry + Stage 1 Triage */}
                <div className="telemetry-card">
                  <div className="telemetry-top">
                    <div className="telemetry-stats">
                      <div className="stat-pill">
                        <span className="stat-k">Model</span>
                        <span className="stat-v">gemini-decision-1</span>
                      </div>
                      <div className="stat-pill">
                        <span className="stat-k">Evaluated</span>
                        <span className="stat-v">
                          {result.candidatesEvaluated} / {result.totalCorpus} reports
                          {result.wave2Triggered ? " (auto-expanded)" : ""}
                        </span>
                      </div>
                      <div className="stat-pill">
                        <span className="stat-k">Tokens</span>
                        <span className="stat-v">
                          {result.totalInputTokens.toLocaleString()} in ·{" "}
                          {result.totalOutputTokens} out
                        </span>
                      </div>
                      <div className="stat-pill">
                        <span className="stat-k">Latency</span>
                        <span className="stat-v">{(result.elapsedMs / 1000).toFixed(2)}s</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn primary"
                      disabled={zipping || result.top5.length === 0}
                      onClick={handleDownloadZip}
                    >
                      <Archive size={16} />
                      <span>{zipping ? "Bundling ZIP..." : "Download Top 5 (.zip)"}</span>
                    </button>
                  </div>

                  {result.detectedFacets.length > 0 && (
                    <div className="facets-row">
                      <span className="facets-label">Stage-1 Triage Signals:</span>
                      {result.detectedFacets.map((f) => (
                        <span key={f.key} className={`facet-chip group-${f.group}`}>
                          {f.label} <strong>{Math.round(f.probability * 100)}%</strong>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Top 5 Report Cards */}
                <div className="results-list">
                  {result.top5.map((item) => {
                    const r = item.report;
                    const scorePct = Math.min(100, Math.round((item.score / 4) * 100));
                    return (
                      <article key={r.id} className="result-card">
                        <div className="result-head">
                          <div className="result-title-block">
                            <div className="badge-row">
                              <span className="rank-badge">#{item.rank} Match</span>
                              <span className={`mod-badge mod-${r.modality.toLowerCase()}`}>
                                {r.modality}
                                {r.contrast ? " + Contrast" : ""}
                              </span>
                              {r.side !== "unspecified" && (
                                <span className="meta-badge">{r.side.toUpperCase()}</span>
                              )}
                              {r.regions.slice(0, 2).map((reg) => (
                                <span key={reg} className="meta-badge">
                                  {REGION_LABELS[reg] ?? reg}
                                </span>
                              ))}
                              {r.hasTable && <span className="meta-badge">Includes Table</span>}
                            </div>
                            <h2>{r.title}</h2>
                            <div className="filename-row">
                              <code>{r.filename}</code>
                              {r.doctor && <span>· {r.doctor}</span>}
                            </div>
                          </div>

                          <div className="score-panel">
                            <div className="score-main">
                              <span className="score-num">{item.score.toFixed(2)}</span>
                              <span className="score-den">/ 4.00</span>
                            </div>
                            <div className="score-bar-track">
                              <div
                                className="score-bar-fill"
                                style={{ width: `${scorePct}%` }}
                              />
                            </div>
                            <div className="score-sub">
                              Confidence: <strong>{Math.round(item.confidence * 100)}%</strong>
                            </div>
                            <div
                              className="prob-mini"
                              title="Calibrated rubric probabilities across levels 0 (unrelated) to 4 (exact match)"
                            >
                              {["0", "1", "2", "3", "4"].map((lvl) => {
                                const pv = item.probabilities[lvl] ?? 0;
                                return (
                                  <div key={lvl} className="prob-col">
                                    <div className="prob-track">
                                      <div
                                        className={`prob-fill lvl-${lvl}`}
                                        style={{ height: `${Math.round(pv * 100)}%` }}
                                      />
                                    </div>
                                    <span>L{lvl}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        <div className="result-body">
                          {r.clinicalProfile && (
                            <p className="snippet">
                              <strong>Clinical Profile:</strong> {r.clinicalProfile}
                            </p>
                          )}
                          <p className="snippet">
                            <strong>Impression:</strong> {r.impression}
                          </p>
                        </div>

                        <div className="result-actions">
                          <button
                            type="button"
                            className="btn primary"
                            disabled={downloadingFile === r.filename}
                            onClick={() => handleDownloadOne(r.filename)}
                          >
                            <Download size={15} />
                            <span>
                              {downloadingFile === r.filename
                                ? "Downloading..."
                                : "Download .docx"}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => setPreviewReport(r)}
                          >
                            <Eye size={15} />
                            <span>Preview Full Report</span>
                          </button>
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => handleCopyReport(r)}
                          >
                            {copiedId === r.id ? <Check size={15} /> : <Copy size={15} />}
                            <span>{copiedId === r.id ? "Copied" : "Copy Text"}</span>
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        ) : (
          /* FULL SEGREGATED ARCHIVE TAB */
          <section className="library-section">
            <div className="library-controls">
              <div className="lib-search-box">
                <Search size={16} />
                <input
                  type="text"
                  placeholder="Filter 671 segregated .docx files by title, clinical profile, or impression..."
                  value={libFilterText}
                  onChange={(e) => setLibFilterText(e.target.value)}
                />
              </div>

              <select
                value={libModalityFilter}
                onChange={(e) => setLibModalityFilter(e.target.value)}
              >
                <option value="all">All Modalities ({corpus.length})</option>
                <option value="MRI">MRI</option>
                <option value="CT">CT</option>
              </select>

              <select
                value={libRegionFilter}
                onChange={(e) => setLibRegionFilter(e.target.value)}
              >
                <option value="all">All Regions ({corpus.length})</option>
                {regionStats.map(([reg, cnt]) => (
                  <option key={reg} value={reg}>
                    {REGION_LABELS[reg] ?? reg} ({cnt})
                  </option>
                ))}
              </select>
            </div>

            <div className="library-count">
              Showing <strong>{filteredLibrary.length}</strong> of {corpus.length} segregated{" "}
              <code>.docx</code> files
            </div>

            <div className="library-grid">
              {filteredLibrary.slice(0, 120).map((r) => (
                <div key={r.id} className="lib-card">
                  <div className="lib-card-top">
                    <span className={`mod-badge mod-${r.modality.toLowerCase()}`}>
                      {r.modality}
                    </span>
                    <span className="meta-badge">
                      {REGION_LABELS[r.regions[0]] ?? r.regions[0]}
                    </span>
                  </div>
                  <h3>{r.title}</h3>
                  <code className="lib-filename">{r.filename}</code>
                  <p className="lib-impr">{r.impression}</p>
                  <div className="lib-actions">
                    <button
                      type="button"
                      className="btn secondary sm"
                      onClick={() => handleDownloadOne(r.filename)}
                    >
                      <Download size={14} />
                      <span>.docx</span>
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => setPreviewReport(r)}
                    >
                      <Eye size={14} />
                      <span>Preview</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {filteredLibrary.length > 120 && (
              <div className="library-more-hint">
                Showing first 120 matches — narrow the filter above to view remaining{" "}
                {filteredLibrary.length - 120} reports.
              </div>
            )}
          </section>
        )}
      </main>

      {/* API KEY SETTINGS MODAL */}
      {keyModalOpen && (
        <div className="modal-backdrop" onClick={() => setKeyModalOpen(false)}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Gemini API Key Settings"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div className="modal-title">
                <KeyRound size={18} />
                <h3>Gemini API Key Settings</h3>
              </div>
              <button
                type="button"
                className="btn ghost icon-only"
                aria-label="Close"
                onClick={() => setKeyModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <p className="modal-desc">
              Your API key is saved only in your browser&apos;s <code>localStorage</code> and used
              to invoke <code>gemini-decision-1</code> (<code>v1beta/decisions</code>).
            </p>

            <label htmlFor="modal-api-key" className="field-label">
              Gemini API Key
            </label>
            <input
              id="modal-api-key"
              type="password"
              className="modal-input"
              placeholder="AIzaSy..."
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveAndVerifyKey(true);
              }}
            />

            {keyError && <div className="alert error">{keyError}</div>}

            <div className="modal-actions">
              {isUnlocked && (
                <button
                  type="button"
                  className="btn danger"
                  onClick={handleClearKey}
                >
                  <Trash2 size={15} />
                  <span>Remove Key &amp; Lock</span>
                </button>
              )}
              <div className="modal-actions-right">
                <button
                  type="button"
                  className="btn secondary"
                  disabled={verifyingKey}
                  onClick={() => handleSaveAndVerifyKey(false)}
                >
                  Save Locally
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={verifyingKey}
                  onClick={() => handleSaveAndVerifyKey(true)}
                >
                  <CheckCircle2 size={15} />
                  <span>{verifyingKey ? "Verifying..." : "Verify & Save"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FULL REPORT PREVIEW MODAL */}
      {previewReport && (
        <div className="modal-backdrop" onClick={() => setPreviewReport(null)}>
          <div
            className="modal-panel preview-panel"
            role="dialog"
            aria-modal="true"
            aria-label={previewReport.title}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <div className="badge-row">
                  <span className={`mod-badge mod-${previewReport.modality.toLowerCase()}`}>
                    {previewReport.modality}
                  </span>
                  <span className="meta-badge">
                    {REGION_LABELS[previewReport.regions[0]] ?? previewReport.regions[0]}
                  </span>
                </div>
                <h3 className="preview-title">{previewReport.title}</h3>
                <code className="preview-file">{previewReport.filename}</code>
              </div>
              <button
                type="button"
                className="btn ghost icon-only"
                aria-label="Close"
                onClick={() => setPreviewReport(null)}
              >
                <X size={18} />
              </button>
            </div>

            <pre className="report-fulltext">{previewReport.fullText}</pre>

            <div className="modal-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={() => handleCopyReport(previewReport)}
              >
                {copiedId === previewReport.id ? <Check size={15} /> : <Copy size={15} />}
                <span>{copiedId === previewReport.id ? "Copied!" : "Copy Full Report"}</span>
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => handleDownloadOne(previewReport.filename)}
              >
                <Download size={15} />
                <span>Download .docx</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
