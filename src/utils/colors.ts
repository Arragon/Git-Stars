/**
 * Generates a consistent, deterministic color based on a string (tag name).
 * This ensures the same tag always gets the same color across different sessions and cards.
 */

// A curated list of soft, visually pleasing Tailwind-like color palettes (background + text + border)
const TAG_COLORS = [
  { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200/60' },
  { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200/60' },
  { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200/60' },
  { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200/60' },
  { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200/60' },
  { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200/60' },
  { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200/60' },
  { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200/60' },
  { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200/60' },
  { bg: 'bg-fuchsia-50', text: 'text-fuchsia-700', border: 'border-fuchsia-200/60' },
  { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200/60' },
];

export function getTagColor(tag: string) {
  if (!tag) return TAG_COLORS[0];
  
  // Simple string hash function
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Get positive index
  const index = Math.abs(hash) % TAG_COLORS.length;
  return TAG_COLORS[index];
}
