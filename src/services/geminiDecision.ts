import { GoogleGenAI } from "@google/genai";
import type {
  AudioAttachment,
  DecisionSearchResult,
  FacetProbability,
  RankedReport,
  ReportRecord,
  SearchStrategy,
} from "../types";

const DECISION_MODEL = "gemini-decision-1";
const SCORE_RUBRIC = [
  "Unrelated body part, modality, or completely different clinical topic.",
  "Same broad imaging modality only, or tangential anatomical overlap.",
  "Partial match on anatomical region or general clinical pattern.",
  "Strong match on anatomical region, modality, and primary pathology.",
  "Exact or near-exact match for the requested scan, side, and clinical findings.",
];

interface FacetDef {
  key: string;
  label: string;
  group: "modality" | "region" | "side" | "theme";
  matchKey: string;
  instructions: string;
}

const STAGE1_FACETS: FacetDef[] = [
  // Modality
  {
    key: "mod_mri",
    label: "MRI Scan",
    group: "modality",
    matchKey: "MRI",
    instructions: "Does the user ask for or describe an MRI scan (or not specify CT/X-ray when describing soft tissue/joint/spine findings)?",
  },
  {
    key: "mod_ct",
    label: "CT Scan",
    group: "modality",
    matchKey: "CT",
    instructions: "Does the user specifically ask for or describe a CT scan (computed tomography, HRCT, CECT, fracture CT)?",
  },
  {
    key: "mod_contrast",
    label: "Contrast Study",
    group: "modality",
    matchKey: "contrast",
    instructions: "Does the input ask for contrast / post-contrast / plain+contrast imaging, infection workup, or tumor enhancement?",
  },
  {
    key: "mod_screening",
    label: "Screening Sequence",
    group: "modality",
    matchKey: "screening",
    instructions: "Does the input ask for screening sequences (e.g., screening of cervical spine, rest of spine, hips, or extremities)?",
  },

  // Anatomical regions
  {
    key: "reg_shoulder",
    label: "Shoulder",
    group: "region",
    matchKey: "shoulder",
    instructions: "Is the input about the shoulder, rotator cuff, supraspinatus, infraspinatus, subscapularis, glenoid labrum, AC joint, Bankart, Hill-Sachs, or adhesive capsulitis?",
  },
  {
    key: "reg_knee",
    label: "Knee",
    group: "region",
    matchKey: "knee",
    instructions: "Is the input about the knee joint, meniscus, ACL, PCL, MCL, LCL, patella, Hoffa fat pad, tibial plateau, Baker cyst, or knee osteoarthritis?",
  },
  {
    key: "reg_lumbar_spine",
    label: "Lumbar / LS Spine",
    group: "region",
    matchKey: "lumbar_spine",
    instructions: "Is the input about the lumbar or lumbosacral spine, low back pain, L1-S1 discs, spondylolysis, anterolisthesis, sciatica, cauda equina, sacrum, or coccyx?",
  },
  {
    key: "reg_cervical_spine",
    label: "Cervical Spine",
    group: "region",
    matchKey: "cervical_spine",
    instructions: "Is the input about the cervical spine, neck pain, C1-C7 disc bulge, uncovertebral arthropathy, cervical cord compression, or cervical spondylosis?",
  },
  {
    key: "reg_dorsal_spine",
    label: "Dorsal / Thoracic Spine",
    group: "region",
    matchKey: "dorsal_spine",
    instructions: "Is the input about the dorsal or thoracic spine (D1-D12 / T1-T12 vertebrae, thoracic cord, or dorsal spondylodiscitis)?",
  },
  {
    key: "reg_ankle_foot",
    label: "Ankle & Foot",
    group: "region",
    matchKey: "ankle_foot",
    instructions: "Is the input about the ankle, foot, hindfoot, midfoot, talus, calcaneus, malleolus, trimalleolar fracture, Achilles tendon, plantar fascia, peroneal tendon, or MTP joint?",
  },
  {
    key: "reg_wrist_hand",
    label: "Wrist & Hand",
    group: "region",
    matchKey: "wrist_hand",
    instructions: "Is the input about the wrist, hand, fingers, thumb, carpal bones, scaphoid, lunate, TFCC, carpal tunnel, or extensor/flexor tendons of the hand?",
  },
  {
    key: "reg_hip_pelvis",
    label: "Hip & Pelvis",
    group: "region",
    matchKey: "hip_pelvis",
    instructions: "Is the input about the hip joint, bony pelvis, femoral head, acetabulum, AVN (avascular necrosis), sacroiliac (SI) joints, trochanter, or FAI?",
  },
  {
    key: "reg_elbow_arm",
    label: "Elbow / Forearm / Arm",
    group: "region",
    matchKey: "elbow_arm",
    instructions: "Is the input about the elbow, humerus, upper arm, forearm, radius, ulna, olecranon, radial head, or upper limb?",
  },
  {
    key: "reg_thigh_leg",
    label: "Thigh / Femur / Leg",
    group: "region",
    matchKey: "thigh_leg",
    instructions: "Is the input about the thigh, femur, lower leg, tibia, fibula, calf muscles, gastrocnemius, hamstring, or lower limb soft tissue?",
  },
  {
    key: "reg_thorax_chest",
    label: "Thorax / Chest / Ribs",
    group: "region",
    matchKey: "thorax_chest",
    instructions: "Is the input about the bony thorax, chest wall, ribs, sternum, clavicle, lungs, or mediastinum/thymus?",
  },
  {
    key: "reg_brachial_nerves",
    label: "Brachial Plexus / Nerves",
    group: "region",
    matchKey: "brachial_nerves",
    instructions: "Is the input about the brachial plexus, nerve root avulsion, sciatic nerve, axillary nerve, or peripheral neuropathy/denervation?",
  },
  {
    key: "reg_brain_head_neck",
    label: "Brain / Orbits / PNS",
    group: "region",
    matchKey: "brain_head_neck",
    instructions: "Is the input about the brain, orbits, optic pathway, paranasal sinuses (PNS), sinusitis, infarct, aneurysm, or skull base?",
  },
  {
    key: "reg_whole_body",
    label: "Whole Body / Whole Spine",
    group: "region",
    matchKey: "whole_body",
    instructions: "Is the input about a whole-body MRI, whole-spine scan, or diffuse multi-limb evaluation?",
  },

  // Laterality
  {
    key: "side_right",
    label: "Right Side",
    group: "side",
    matchKey: "right",
    instructions: "Does the user specify the RIGHT side?",
  },
  {
    key: "side_left",
    label: "Left Side",
    group: "side",
    matchKey: "left",
    instructions: "Does the user specify the LEFT side?",
  },
  {
    key: "side_bilateral",
    label: "Bilateral",
    group: "side",
    matchKey: "bilateral",
    instructions: "Does the user specify BILATERAL / both sides?",
  },

  // Clinical themes
  {
    key: "thm_trauma_fracture",
    label: "Trauma / Fracture",
    group: "theme",
    matchKey: "trauma_fracture",
    instructions: "Does the case involve acute trauma, RTA, fall, bone fracture, dislocation, avulsion, bone contusion, or sprain?",
  },
  {
    key: "thm_tear_tendon_ligament",
    label: "Tendon / Ligament / Meniscal Tear",
    group: "theme",
    matchKey: "tear_tendon_ligament",
    instructions: "Does the case involve a tear, tendinosis, rupture, or injury of a tendon, ligament, meniscus, labrum, or TFCC?",
  },
  {
    key: "thm_degenerative_disc_oa",
    label: "Degenerative / Disc / OA",
    group: "theme",
    matchKey: "degenerative_disc_oa",
    instructions: "Does the case involve degenerative changes, osteoarthrosis/osteoarthritis, spondylosis, disc bulge/protrusion, stenosis, or impingement?",
  },
  {
    key: "thm_tumor_mass_cyst",
    label: "Tumor / Mass / Cyst",
    group: "theme",
    matchKey: "tumor_mass_cyst",
    instructions: "Does the case involve a tumor, sarcoma, osteosarcoma, mass lesion, metastasis, lytic lesion, or ganglion/paralabral/Baker cyst?",
  },
  {
    key: "thm_infection_abscess",
    label: "Infection / Osteomyelitis / Abscess",
    group: "theme",
    matchKey: "infection_abscess",
    instructions: "Does the case involve infection, osteomyelitis, septic arthritis, cellulitis, abscess, fluid collection, or spondylodiscitis?",
  },
  {
    key: "thm_inflammatory_arthritis",
    label: "Inflammatory / Arthritis / Synovitis",
    group: "theme",
    matchKey: "inflammatory_arthritis",
    instructions: "Does the case involve inflammatory arthritis (RA, psoriatic, gout), synovitis, bursitis, tenosynovitis, myositis, sacroiliitis, or adhesive capsulitis?",
  },
  {
    key: "thm_post_operative",
    label: "Post-operative / Implant",
    group: "theme",
    matchKey: "post_operative",
    instructions: "Does the case involve post-operative status, prior surgery, pedicle screws, spinal fusion, ACL graft, arthroplasty, or prosthesis?",
  },
  {
    key: "thm_avn_marrow_stress",
    label: "AVN / Stress / OLT",
    group: "theme",
    matchKey: "avn_marrow_stress",
    instructions: "Does the case involve avascular necrosis (AVN), osteonecrosis, stress/insufficiency fracture, or osteochondral lesion (OLT)?",
  },
  {
    key: "thm_normal_study",
    label: "Normal Study",
    group: "theme",
    matchKey: "normal_study",
    instructions: "Is the user specifically looking for a normal / unremarkable study template with no significant abnormality?",
  },
];

function buildDecisionInput(textQuery: string, audio?: AudioAttachment | null) {
  if (audio) {
    const blocks: Array<
      | { type: "audio"; data: string; mime_type: string }
      | { type: "text"; text: string }
    > = [
      {
        type: "audio",
        data: audio.base64,
        mime_type: audio.mimeType,
      },
    ];
    if (textQuery.trim()) {
      blocks.push({
        type: "text",
        text: `\nAdditional clinical note: ${textQuery.trim()}`,
      });
    }
    return blocks;
  }
  return textQuery.trim();
}

export async function verifyGeminiApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error("Please enter a Gemini API key.");
  }
  const ai = new GoogleGenAI({ apiKey: trimmed, apiVersion: "v1beta" });
  const res = await ai.decisions.create({
    model: DECISION_MODEL,
    input: "MRI scan of right knee joint with ACL tear.",
    questions: {
      healthcheck: {
        type: "noul",
        instructions: "Does this text describe an MRI scan of the knee?",
      },
    },
  });
  const ans = res.answers?.healthcheck;
  if (!ans || ans.type !== "noul") {
    throw new Error("Unexpected response from gemini-decision-1.");
  }
}

function computeCandidatePriors(
  reports: ReportRecord[],
  facetMap: Record<string, number>,
  textQuery: string
): Array<{ report: ReportRecord; prior: number }> {
  const regionFacets = STAGE1_FACETS.filter((f) => f.group === "region");
  const themeFacets = STAGE1_FACETS.filter((f) => f.group === "theme");

  const tokens = textQuery
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length >= 3 && !["mri", "scan", "with", "and", "the", "for", "joint", "pain"].includes(w));

  const maxRegionP = Math.max(...regionFacets.map((f) => facetMap[f.key] ?? 0.01));
  const mriP = facetMap["mod_mri"] ?? 0.5;
  const ctP = facetMap["mod_ct"] ?? 0.5;
  const contrastP = facetMap["mod_contrast"] ?? 0.1;
  const screenP = facetMap["mod_screening"] ?? 0.1;
  const rightP = facetMap["side_right"] ?? 0.01;
  const leftP = facetMap["side_left"] ?? 0.01;
  const bilatP = facetMap["side_bilateral"] ?? 0.01;

  return reports.map((r) => {
    let score = 0;

    // 1. Region match (primary region weighted 2.5x, secondary regions 1.0x)
    const primaryReg = r.regions[0];
    const primFacet = regionFacets.find((f) => f.matchKey === primaryReg);
    const primProb = primFacet ? facetMap[primFacet.key] ?? 0.01 : 0.05;
    score += primProb * 4.2;

    let bestSecProb = 0;
    for (let i = 1; i < r.regions.length; i++) {
      const sf = regionFacets.find((f) => f.matchKey === r.regions[i]);
      if (sf) bestSecProb = Math.max(bestSecProb, facetMap[sf.key] ?? 0.01);
    }
    score += bestSecProb * 1.6;

    // Penalize unrelated regions slightly when Stage 1 is highly confident about a region
    if (maxRegionP >= 0.7 && primProb < 0.15 && bestSecProb < 0.2) {
      score -= 1.2;
    }

    // 2. Modality affinity
    if (ctP > 0.65 && mriP < 0.45) {
      score += r.modality === "CT" ? 1.6 : -0.6;
    } else if (mriP > 0.65 && ctP < 0.45) {
      score += r.modality === "MRI" ? 0.9 : -0.3;
    }
    if (contrastP > 0.55 && r.contrast) score += 0.5;
    if (screenP > 0.55 && r.screening) score += 0.4;

    // 3. Laterality affinity
    if (rightP > 0.65 && r.side === "right") score += 0.65;
    else if (leftP > 0.65 && r.side === "left") score += 0.65;
    else if (bilatP > 0.65 && r.side === "bilateral") score += 0.75;
    else if ((rightP > 0.75 && r.side === "left") || (leftP > 0.75 && r.side === "right")) {
      score -= 0.25;
    }

    // 4. Clinical theme affinity (only positive signals)
    for (const tf of themeFacets) {
      const p = facetMap[tf.key] ?? 0.01;
      if (p >= 0.45 && r.themes.includes(tf.matchKey)) {
        score += p * 1.1;
      }
    }

    // 5. Lexical safety net for typed rare terms (e.g. Schatzker, Hepple, Kerboul, osteosarcoma, Tarlov)
    if (tokens.length > 0) {
      const hay = (r.title + " " + r.clinicalProfile + " " + r.impression).toLowerCase();
      let hits = 0;
      for (const tok of tokens) {
        if (hay.includes(tok)) hits++;
      }
      score += Math.min(2.2, (hits / tokens.length) * 1.8);
    }

    return { report: r, prior: score };
  });
}

async function scoreCandidateBatch(
  ai: GoogleGenAI,
  input: ReturnType<typeof buildDecisionInput>,
  candidates: Array<{ report: ReportRecord; prior: number }>
): Promise<{
  ranked: RankedReport[];
  inputTokens: number;
}> {
  const questions: Record<
    string,
    { type: "score"; instructions: string; criteria: string[] }
  > = {};

  const byId = new Map<string, { report: ReportRecord; prior: number }>();
  for (const item of candidates) {
    byId.set(item.report.id, item);
    questions[item.report.id] = {
      type: "score",
      instructions: `How well does this MSK radiology report format match the user's clinical query? Report: "${item.report.summary}"`,
      criteria: SCORE_RUBRIC,
    };
  }

  const res = await ai.decisions.create({
    model: DECISION_MODEL,
    input,
    questions,
  });

  const ranked: RankedReport[] = [];
  for (const [qid, ans] of Object.entries(res.answers ?? {})) {
    const entry = byId.get(qid);
    if (!entry || ans.type !== "score") continue;
    ranked.push({
      report: entry.report,
      rank: 0,
      score: ans.score,
      confidence: ans.confidence,
      probabilities: ans.probabilities ?? {},
      priorScore: entry.prior,
    });
  }

  const inputTokens = res.usage?.total_input_tokens ?? 0;
  return { ranked, inputTokens };
}

export async function findTopReportsWithDecision1(params: {
  apiKey: string;
  corpus: ReportRecord[];
  textQuery: string;
  audio?: AudioAttachment | null;
  strategy: SearchStrategy;
  onPhase?: (phase: string) => void;
}): Promise<DecisionSearchResult> {
  const { apiKey, corpus, textQuery, audio, strategy, onPhase } = params;
  const startedAt = performance.now();

  if (!textQuery.trim() && !audio) {
    throw new Error("Provide either a text description or an audio recording/file.");
  }

  const ai = new GoogleGenAI({ apiKey: apiKey.trim(), apiVersion: "v1beta" });
  const input = buildDecisionInput(textQuery, audio);

  // Stage 1: Calibrated multimodal triage over 30 clinical facets using gemini-decision-1
  onPhase?.("Stage 1/2: Analyzing clinical modality, anatomy, and findings via gemini-decision-1...");
  const stage1Questions: Record<string, { type: "noul"; instructions: string }> = {};
  for (const facet of STAGE1_FACETS) {
    stage1Questions[facet.key] = {
      type: "noul",
      instructions: facet.instructions,
    };
  }

  const stage1Res = await ai.decisions.create({
    model: DECISION_MODEL,
    input,
    questions: stage1Questions,
  });

  let totalInputTokens = stage1Res.usage?.total_input_tokens ?? 0;
  let totalOutputTokens = stage1Res.usage?.total_output_tokens ?? 0;

  const facetMap: Record<string, number> = {};
  const detectedFacets: FacetProbability[] = [];

  for (const facet of STAGE1_FACETS) {
    const ans = stage1Res.answers?.[facet.key];
    const p = ans?.type === "noul" ? ans.noul : 0.01;
    facetMap[facet.key] = p;
    if (p >= 0.35) {
      detectedFacets.push({
        key: facet.key,
        label: facet.label,
        group: facet.group,
        probability: p,
      });
    }
  }
  detectedFacets.sort((a, b) => b.probability - a.probability);

  const priors = computeCandidatePriors(corpus, facetMap, textQuery);
  priors.sort((a, b) => b.prior - a.prior);

  let allScored: RankedReport[] = [];
  let wave2Triggered = false;

  if (strategy === "exhaustive") {
    // Score ALL reports in one request (671 <= 1000 max questions per request)
    onPhase?.(`Stage 2/2: Scoring all ${corpus.length} segregated reports with gemini-decision-1...`);
    const batch = await scoreCandidateBatch(ai, input, priors);
    allScored = batch.ranked;
    totalInputTokens += batch.inputTokens;
  } else {
    // Stage 2: Score top 90 shortlisted candidates (~4k tokens, safe for Free Tier 50k TPM)
    const wave1Pool = priors.slice(0, 90);
    onPhase?.(
      `Stage 2/2: Scoring top ${wave1Pool.length} candidate formats with gemini-decision-1...`
    );
    const wave1 = await scoreCandidateBatch(ai, input, wave1Pool);
    allScored = wave1.ranked;
    totalInputTokens += wave1.inputTokens;

    const bestWave1Score = allScored.reduce((m, r) => Math.max(m, r.score), 0);
    // Adaptive fallback if top match is weak (< 1.85 / 4.0)
    if (bestWave1Score < 1.85 && priors.length > 90) {
      wave2Triggered = true;
      const wave2Pool = priors.slice(90, 180);
      onPhase?.(
        `Expanding search: scoring next ${wave2Pool.length} candidate formats with gemini-decision-1...`
      );
      const wave2 = await scoreCandidateBatch(ai, input, wave2Pool);
      allScored.push(...wave2.ranked);
      totalInputTokens += wave2.inputTokens;
    }
  }

  allScored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
    const p4Diff = (b.probabilities["4"] ?? 0) - (a.probabilities["4"] ?? 0);
    if (Math.abs(p4Diff) > 0.001) return p4Diff;
    return b.confidence - a.confidence;
  });

  const top5 = allScored.slice(0, 5).map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));

  return {
    top5,
    detectedFacets: detectedFacets.slice(0, 10),
    candidatesEvaluated: allScored.length,
    totalCorpus: corpus.length,
    totalInputTokens,
    totalOutputTokens,
    elapsedMs: Math.round(performance.now() - startedAt),
    strategyUsed: strategy,
    wave2Triggered,
  };
}
