/**
 * Pitched flower sounds, adapted from cuelume's synth recipes
 * (https://github.com/Danilaa1/cuelume). Cuelume's public `play()` API has
 * no pitch control, so the three recipes we use (bloom, sparkle, droplet)
 * are reproduced here with a pitch-ratio parameter. To swap a flower's
 * sound later, edit its recipe below (or replace `playFlowerNote`).
 */

export type FlowerKind = "A" | "B" | "C";

type ToneLayer = {
  kind: "tone";
  waveform: OscillatorType;
  frequency: number;
  detune?: number;
  glideTo?: number;
  glideTime?: number;
  offset?: number;
  attack: number;
  decay: number;
  peak: number;
};

type Shimmer = { delay: number; feedback: number; wet: number; lowpass: number };

type Recipe = { masterGain: number; layers: ToneLayer[]; shimmer?: Shimmer };

/** FlowerKind -> recipe. Swap these out to change a flower's sound. */
const FLOWER_RECIPES: Record<FlowerKind, Recipe> = {
  // cuelume "bloom" — warm slow swell
  A: {
    masterGain: 0.5,
    layers: [
      { kind: "tone", waveform: "sine", frequency: 528, attack: 0.06, decay: 0.32, peak: 0.06 },
      { kind: "tone", waveform: "sine", frequency: 528, detune: 12, attack: 0.06, decay: 0.34, peak: 0.05 },
    ],
    shimmer: { delay: 0.15, feedback: 0.2, wet: 0.12, lowpass: 2500 },
  },
  // cuelume "sparkle" — quick four-note twinkle
  B: {
    masterGain: 0.5,
    layers: [
      { kind: "tone", waveform: "sine", frequency: 1760, offset: 0, attack: 0.003, decay: 0.09, peak: 0.045 },
      { kind: "tone", waveform: "sine", frequency: 2217, offset: 0.045, attack: 0.003, decay: 0.09, peak: 0.04 },
      { kind: "tone", waveform: "sine", frequency: 2637, offset: 0.09, attack: 0.003, decay: 0.1, peak: 0.038 },
      { kind: "tone", waveform: "sine", frequency: 3520, offset: 0.135, attack: 0.003, decay: 0.12, peak: 0.032 },
    ],
    shimmer: { delay: 0.07, feedback: 0.35, wet: 0.22, lowpass: 6000 },
  },
  // cuelume "droplet" — single note gliding down
  C: {
    masterGain: 0.55,
    layers: [
      { kind: "tone", waveform: "sine", frequency: 1200, glideTo: 550, glideTime: 0.14, attack: 0.004, decay: 0.2, peak: 0.075 },
    ],
    shimmer: { delay: 0.09, feedback: 0.2, wet: 0.15, lowpass: 3000 },
  },
};

let sharedContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (sharedContext) return sharedContext;
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    sharedContext = new Ctor();
  } catch {
    return null;
  }
  return sharedContext;
}

const SOURCE_STOP_PADDING = 0.05;

function renderTone(
  context: AudioContext,
  destination: AudioNode,
  layer: ToneLayer,
  startTime: number,
  ratio: number
) {
  const duration = layer.attack + layer.decay + SOURCE_STOP_PADDING;
  const osc = context.createOscillator();
  osc.type = layer.waveform;
  osc.frequency.setValueAtTime(layer.frequency * ratio, startTime);
  if (layer.detune !== undefined) osc.detune.value = layer.detune;
  if (layer.glideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(
      layer.glideTo * ratio,
      startTime + (layer.glideTime ?? layer.attack + layer.decay)
    );
  }
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(layer.peak, startTime + layer.attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + layer.attack + layer.decay);
  osc.connect(gain).connect(destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

function attachShimmer(
  context: AudioContext,
  source: AudioNode,
  destination: AudioNode,
  shimmer: Shimmer
): AudioNode[] {
  const delay = context.createDelay(1);
  delay.delayTime.value = shimmer.delay;
  const feedbackFilter = context.createBiquadFilter();
  feedbackFilter.type = "lowpass";
  feedbackFilter.frequency.value = shimmer.lowpass;
  const feedbackGain = context.createGain();
  feedbackGain.gain.value = shimmer.feedback;
  const wetGain = context.createGain();
  wetGain.gain.value = shimmer.wet;
  source.connect(delay);
  delay.connect(feedbackFilter);
  feedbackFilter.connect(feedbackGain);
  feedbackGain.connect(delay);
  feedbackFilter.connect(wetGain);
  wetGain.connect(destination);
  return [delay, feedbackFilter, feedbackGain, wetGain];
}

/**
 * Plays a flower's sound transposed by `semitones` relative to the recipe's
 * default pitch. Negative values go lower, positive higher.
 */
export function playFlowerNote(flower: FlowerKind, semitones: number) {
  const context = getAudioContext();
  if (!context) return;
  if (context.state !== "running") {
    try {
      void context.resume();
    } catch {
      return;
    }
  }
  const recipe = FLOWER_RECIPES[flower];
  const ratio = Math.pow(2, semitones / 12);
  const now = context.currentTime;
  const master = context.createGain();
  master.gain.value = recipe.masterGain;
  master.connect(context.destination);
  const shimmerNodes = recipe.shimmer
    ? attachShimmer(context, master, context.destination, recipe.shimmer)
    : [];
  let end = 0;
  for (const layer of recipe.layers) {
    const startTime = now + (layer.offset ?? 0);
    renderTone(context, master, layer, startTime, ratio);
    end = Math.max(end, (layer.offset ?? 0) + layer.attack + layer.decay + SOURCE_STOP_PADDING);
  }
  const shimmerTail = recipe.shimmer
    ? recipe.shimmer.delay * (1 + Math.ceil(Math.log(0.001) / Math.log(recipe.shimmer.feedback)))
    : 0;
  setTimeout(() => {
    master.disconnect();
    for (const node of shimmerNodes) node.disconnect();
  }, (end + shimmerTail + 0.1) * 1000);
}
