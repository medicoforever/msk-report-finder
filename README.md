# MSK Report Finder (`gemini-decision-1`)

Static GitHub Pages web application that evaluates **text** or **audio** clinical queries using Google's **`gemini-decision-1`** Decisions API (`v1beta`) to retrieve and rank the **Top 5 matching MSK radiology report `.docx` templates** from **671 segregated Word documents**.

## Key Features
- **API Key Gate (`localStorage`)**: Prompts for and optionally verifies a user-supplied Gemini API key against `gemini-decision-1` before unlocking search/audio retrieval. Keys stay strictly in browser `localStorage`.
- **671 Segregated `.docx` Files**: Every distinct report from `MSK report formats.docx` is preserved as an individual downloadable `.docx` under `public/reports/` (keeping original Word formatting, bulleted impressions, and tables).
- **Text & Direct Audio Input**: Type clinical queries or record live microphone audio (transcoded to 16 kHz mono WAV `audio/wav`) / upload audio files (`WAV`, `MP3`, `M4A`, `WEBM`, `OGG`, `FLAC`) — evaluated natively by `gemini-decision-1`.
- **Two-Stage Decision Cascade**:
  1. **Stage 1 (`noul` facets)**: Calibrated yes/no probabilities across 30 clinical facets (modality, anatomical region, laterality, pathology).
  2. **Stage 2 (`score` rubric)**: Calibrated `0..4` rubric scoring (`ScoreAnswer` with confidence and level probability distribution) to return the Top 5 `.docx` matches (plus optional full-671 scan mode).
- **Instant `.docx` & `.zip` Export**: Download individual `.docx` files, preview full reports, copy report text, or bundle all Top 5 into `MSK_Top5_Reports.zip`.
