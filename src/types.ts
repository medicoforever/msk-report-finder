export type Modality = "MRI" | "CT";

export type Side = "right" | "left" | "bilateral" | "unspecified";

export interface ReportRecord {
  id: string;
  num: number;
  filename: string;
  title: string;
  modality: Modality;
  contrast: boolean;
  screening: boolean;
  side: Side;
  regions: string[];
  themes: string[];
  doctor: string;
  clinicalProfile: string;
  technique: string;
  impression: string;
  summary: string;
  hasTable: boolean;
  fullText: string;
}

export interface ReportsCorpus {
  source: string;
  totalReports: number;
  reports: ReportRecord[];
}

export type InputMode = "text" | "audio";

export type SearchStrategy = "cascade" | "exhaustive";

export interface AudioAttachment {
  base64: string;
  mimeType: string;
  durationSec: number;
  sizeBytes: number;
  filename: string;
  previewUrl: string;
}

export interface FacetProbability {
  key: string;
  label: string;
  group: "modality" | "region" | "side" | "theme";
  probability: number;
}

export interface RankedReport {
  report: ReportRecord;
  rank: number;
  score: number; // 0..4 expected value from gemini-decision-1
  confidence: number; // 0..1 calibrated confidence
  probabilities: Record<string, number>; // "0".."4"
  priorScore: number;
}

export interface DecisionSearchResult {
  top5: RankedReport[];
  detectedFacets: FacetProbability[];
  candidatesEvaluated: number;
  totalCorpus: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  elapsedMs: number;
  strategyUsed: SearchStrategy;
  wave2Triggered: boolean;
}
