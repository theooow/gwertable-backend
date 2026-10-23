// Closed list so anonymised events can be compared across workspaces.
export const EVENT_GENRES = [
  "TECHNO", "HOUSE", "ELECTRO", "DRUM_AND_BASS", "TRANCE", "HARD_MUSIC", "DISCO_FUNK",
  "HIP_HOP", "AFRO", "LATIN", "REGGAE_DUB", "ROCK", "METAL", "PUNK", "POP",
  "JAZZ_SOUL", "CLASSICAL", "CHANSON", "WORLD", "EXPERIMENTAL", "OTHER",
] as const;

export type EventGenre = (typeof EVENT_GENRES)[number];
