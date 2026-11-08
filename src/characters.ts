export interface Character {
  id: 'shadow' | 'web' | 'void';
  name: string;
  line: string;
  /** eye colours for the selector glyph */
  eye: string;
  glow: string;
}

export const CHARACTERS: Character[] = [
  { id: 'shadow', name: 'Shadow', line: 'Your silhouette goes dark. Two eyes stay lit.', eye: '#fff3c4', glow: '#f4c969' },
  { id: 'web', name: 'Web', line: 'Red mask, white lenses, a web drawn across your face.', eye: '#ffffff', glow: '#e0284a' },
  { id: 'void', name: 'Anime', line: 'A soft painted face, amber eyes and your own hair as anime line art.', eye: '#e2a35a', glow: '#3fb7b8' },
];

export function characterIndex(id: string | null | undefined): number {
  const i = CHARACTERS.findIndex((c) => c.id === id);
  return i < 0 ? 0 : i;
}
