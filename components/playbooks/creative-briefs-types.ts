// What a Creative briefs write-up is made of once its paragraphs are told apart (T23 UI). The parser (creative-briefs.ts) produces it
// and the view (creative-briefs-view.tsx) draws it. Every string is the model's own text with the double-asterisk lead-in removed:
// nothing is invented, and whatever the parser does not recognise is kept (in `other` or `rest`) so the page never drops a word.

export interface CreativeBrief {
  title: string; // "Best customers first" (a leading "Brief 1:" is removed)
  who: string | null;
  product: string | null;
  angle: string | null; // without its surrounding double quotes
  hooks: string[]; // each without quotes; [] when the line is missing
  offer: string | null;
  proof: string | null;
  doNot: string | null;
  measure: string | null;
  other: { label: string; text: string }[]; // any item line whose name the parser does not know, in the order written
}

export interface CreativeBriefsParsed {
  campaign: string | null; // the "Campaign." paragraph
  lastYear: string | null; // the "Last year." paragraph
  notPushing: string | null; // the "Not pushing." paragraph
  briefs: CreativeBrief[]; // in the order written; the parse fails (null) unless there are at least two
  rest: string[]; // every other paragraph, in order, so nothing is dropped
}
