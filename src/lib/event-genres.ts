// Closed list so anonymised events can be compared across workspaces.
export const EVENT_GENRES = [
  "TECHNO", "HOUSE", "ELECTRO", "DRUM_AND_BASS", "TRANCE", "HARD_MUSIC", "DISCO_FUNK",
  "HIP_HOP", "AFRO", "LATIN", "REGGAE_DUB", "ROCK", "METAL", "PUNK", "POP",
  "JAZZ_SOUL", "CLASSICAL", "CHANSON", "WORLD", "EXPERIMENTAL", "OTHER",
] as const;

export type EventGenre = (typeof EVENT_GENRES)[number];

// Order matters: specific scenes are matched before the broader ones they contain.
const GENRE_PATTERNS: [EventGenre, RegExp][] = [
  ["HARD_MUSIC", /\b(hardcore|hardstyle|hardtek|hard techno|gabber|frenchcore|tekno|free ?party)\b/],
  ["DRUM_AND_BASS", /\b(drum ?(and|n)? ?bass|dnb|jungle|breakbeat)\b/],
  ["TECHNO", /\b(techno|minimal)\b/],
  ["HOUSE", /\b(house|garage)\b/],
  ["TRANCE", /\b(trance|psytrance|psy)\b/],
  ["DISCO_FUNK", /\b(disco|funk|boogie)\b/],
  ["ELECTRO", /\b(electro|electronic|electronique|edm|dubstep|bass music)\b/],
  ["HIP_HOP", /\b(hip ?hop|rap|trap|drill|rnb|r ?n ?b)\b/],
  ["AFRO", /\b(afro\w*|amapiano|kompa|zouk|baile funk)\b/],
  ["LATIN", /\b(latin\w*|reggaeton|salsa|cumbia|bachata)\b/],
  ["REGGAE_DUB", /\b(reggae|dub|dancehall|ska)\b/],
  ["METAL", /\b(\w*metal)\b/],
  ["PUNK", /\b(punk|hardcore punk)\b/],
  ["ROCK", /\b(rock|indie|grunge)\b/],
  ["POP", /\b(pop|k ?pop)\b/],
  ["JAZZ_SOUL", /\b(jazz|soul|blues|gospel)\b/],
  ["CLASSICAL", /\b(classique|classical|baroque|opera)\b/],
  ["CHANSON", /\b(chanson|variete)\b/],
  ["WORLD", /\b(world|musiques? du monde|folk|trad)\b/],
  ["EXPERIMENTAL", /\b(experimental|ambient|noise)\b/],
];

/** Maps free genre labels (e.g. from Shotgun) to the closed list; unknown labels are dropped. */
export function matchEventGenres(labels: string[]): EventGenre[] {
  const genres = new Set<EventGenre>();
  for (const label of labels) {
    let rest = label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
    for (const [genre, pattern] of GENRE_PATTERNS) {
      if (!pattern.test(rest)) continue;
      genres.add(genre);
      // "hard techno" is hard music, not techno as well.
      rest = rest.replace(new RegExp(pattern.source, "g"), " ");
    }
  }
  return [...genres].slice(0, 5);
}
