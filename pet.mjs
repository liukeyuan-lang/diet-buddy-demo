// Presentation-only pet contract. These V0.6F files are candidate artwork for
// visual acceptance, not final production-approved art. The caller retains the
// adjacent legacy SVG fallback if an image cannot load.
export const PET_ASSET_FILENAMES = Object.freeze({
  soft: Object.freeze({ companion: 'pet-soft-companion.webp', excited: 'pet-soft-excited.webp', rest: 'pet-soft-rest.webp' }),
  light: Object.freeze({ companion: 'pet-light-companion.webp', excited: 'pet-light-excited.webp', rest: 'pet-light-rest.webp' }),
  strong: Object.freeze({ companion: 'pet-strong-companion.webp', excited: 'pet-strong-excited.webp', rest: 'pet-strong-rest.webp' }),
});

export const PET_ASSETS = Object.freeze({
  soft: Object.freeze({
    companion: 'assets/pet/pet-soft-companion.webp',
    excited: 'assets/pet/pet-soft-excited.webp',
    rest: 'assets/pet/pet-soft-rest.webp',
  }),
  light: Object.freeze({
    companion: 'assets/pet/pet-light-companion.webp',
    excited: 'assets/pet/pet-light-excited.webp',
    rest: 'assets/pet/pet-light-rest.webp',
  }),
  strong: Object.freeze({
    companion: 'assets/pet/pet-strong-companion.webp',
    excited: 'assets/pet/pet-strong-excited.webp',
    rest: 'assets/pet/pet-strong-rest.webp',
  }),
  eyesClosed: null,
});

// Generated from the approved orange/white master as four separately padded,
// transparent walk-cycle candidates. They stay separate from the approved 3×3
// mood artwork and are only exposed by the opt-in prototype route.
export const PET_WALK_CANDIDATE_ASSETS = Object.freeze([
  'assets/pet/pet-soft-walk-candidate-1.png',
  'assets/pet/pet-soft-walk-candidate-2.png',
  'assets/pet/pet-soft-walk-candidate-3.png',
  'assets/pet/pet-soft-walk-candidate-4.png',
]);

const MOOD_ALIASES = Object.freeze({
  normal: 'companion', idle: 'companion', companion: 'companion',
  happy: 'excited', excited: 'excited',
  rest: 'rest', resting: 'rest', sleep: 'rest',
});
const BODY_VARIANTS = new Set(['soft', 'light', 'strong']);

export function normalizePetMood(mood) {
  return MOOD_ALIASES[String(mood || '').toLowerCase()] || 'companion';
}

export function normalizeBodyVariant(bodyVariant) {
  return BODY_VARIANTS.has(String(bodyVariant || '').toLowerCase()) ? String(bodyVariant).toLowerCase() : 'soft';
}

export function normalizePetContext(context) {
  return ['home', 'reward', 'ending', 'setup'].includes(context) ? context : 'home';
}

// This is intentionally a proposal only. Callers must collect an explicit user
// confirmation before applying it; task outcomes, calories, or weight data do
// not belong in this presentation-layer API.
export function proposeBodyVariant(currentBodyVariant, proposedBodyVariant) {
  const current = normalizeBodyVariant(currentBodyVariant);
  const proposed = normalizeBodyVariant(proposedBodyVariant);
  return Object.freeze({ current, proposed, requiresConfirmation: current !== proposed });
}

export function confirmBodyVariant(currentBodyVariant, proposal, explicitlyConfirmed = false) {
  const current = normalizeBodyVariant(currentBodyVariant);
  if (!explicitlyConfirmed || !proposal || proposal.current !== current || !proposal.requiresConfirmation) return current;
  return normalizeBodyVariant(proposal.proposed);
}

export function petRenderSpec(input = 'companion', legacyContext = 'home') {
  // The positional form remains for V0.6A callers: petRenderSpec('happy', 'home').
  const options = input && typeof input === 'object' ? input : { mood: input, context: legacyContext };
  const bodyVariant = normalizeBodyVariant(options.bodyVariant);
  const mood = normalizePetMood(options.mood);
  return {
    bodyVariant,
    mood,
    context: normalizePetContext(options.context),
    asset: PET_ASSETS[bodyVariant][mood],
    // A standalone eye layer is required before blink can be enabled.
    hasIndependentEyes: Boolean(PET_ASSETS.eyesClosed),
  };
}

// Atomic delegated load-failure fallback for both a formal WebP and the
// optional multi-frame candidate. Every lookup is scoped to one pet render so
// an adjacent resting image cannot redirect or expose another pet's fallback.
export function activatePetFallback(image) {
  if (!image?.classList?.contains('pet-image') && !image?.classList?.contains('pet-walk-frame')) return false;
  const petRender = image.closest?.('.pet-render');
  if (!petRender) return false;
  image.hidden = true;
  const candidateViewport = petRender.querySelector('.pet-walk-viewport');
  const candidateRestArt = petRender.querySelector('.pet-nest-rest-art');
  const fallback = petRender.querySelector('.pet-fallback');
  if (candidateViewport) candidateViewport.hidden = true;
  if (candidateRestArt) candidateRestArt.hidden = true;
  if (!fallback) return false;
  fallback.hidden = false;
  return true;
}
