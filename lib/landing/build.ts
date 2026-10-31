import { AppError } from "../errors";
import { handleSchema, sectionPath, templatePath, type LandingCampaign, type LandingCopy, type LandingFile, type LandingProduct } from "./types";

// Builds the Liquid section and the page template from fixed templates. Pure: no database, no network.
// The copy is escaped for HTML and for Liquid. Prices and stock are never written: the page reads them from the store's
// own product objects (`{{ p.price | money }}`, `p.available`) every time it loads.

export function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\{/g, "&#123;") // so that copy can never open a Liquid tag or output
    .replace(/\}/g, "&#125;");
}

export function slugify(text: string, max = 40): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cut = slug.length <= max ? slug : slug.slice(0, max).replace(/-[^-]*$/, "") || slug.slice(0, max);
  return cut.replace(/^-+|-+$/g, "") || "page";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(ymd: string): { y: number; m: number; d: number } | null {
  const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!hit) return null;
  const [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { y, m, d } : null;
}

// "Nov 28 to Dec 1, 2025". Empty when a date is not a date.
export function dateRange(from: string, to: string): string {
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return "";
  const day = (p: { m: number; d: number }) => `${MONTHS[p.m - 1]} ${p.d}`;
  if (a.y !== b.y) return `${day(a)}, ${a.y} to ${day(b)}, ${b.y}`;
  if (a.m === b.m && a.d === b.d) return `${day(a)}, ${a.y}`;
  if (a.m === b.m) return `${day(a)} to ${b.d}, ${a.y}`;
  return `${day(a)} to ${day(b)}, ${a.y}`;
}

// Every number a campaign row holds (its title, notes and dates). The copy may repeat these and no others, because
// they are the plan the team wrote down; any other number would be one the model made up.
export function campaignNumbers(c: LandingCampaign | undefined): Set<string> {
  const out = new Set<string>();
  if (!c) return out;
  for (const text of [c.title, c.details ?? "", c.dateFrom, c.dateTo]) {
    for (const hit of text.match(/\d+/g) ?? []) out.add(String(Number(hit)));
  }
  return out;
}

const CSS = `.oasis-landing { max-width: 72rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
.oasis-landing__hero { text-align: center; padding: 2rem 0; }
.oasis-landing__eyebrow { text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.85rem; opacity: 0.7; margin: 0 0 0.5rem; }
.oasis-landing__headline { font-size: clamp(2rem, 5vw, 3.25rem); line-height: 1.1; margin: 0 0 0.75rem; }
.oasis-landing__subhead { font-size: 1.15rem; max-width: 40rem; margin: 0 auto 1.25rem; }
.oasis-landing__bullets { list-style: none; padding: 0; margin: 0 auto 1.5rem; max-width: 36rem; text-align: left; }
.oasis-landing__bullets li { padding: 0.35rem 0 0.35rem 1.5rem; position: relative; }
.oasis-landing__bullets li::before { content: "\\2713"; position: absolute; left: 0; }
.oasis-landing__cta { display: inline-block; padding: 0.85rem 2rem; border: 2px solid currentColor; border-radius: 4px; text-decoration: none; font-weight: 600; }
.oasis-landing__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 1.5rem; margin-top: 2rem; }
.oasis-landing__card { display: flex; flex-direction: column; gap: 0.5rem; }
.oasis-landing__card img { width: 100%; height: auto; display: block; }
.oasis-landing__name { font-size: 1.05rem; margin: 0; }
.oasis-landing__price s { opacity: 0.6; margin-left: 0.4rem; }
.oasis-landing__stock { font-size: 0.9rem; opacity: 0.75; }`;

function card(handle: string): string {
  return `    {%- assign p = all_products['${handle}'] -%}
    {%- if p != blank -%}
      <article class="oasis-landing__card">
        <a href="{{ p.url }}">{{ p.featured_image | image_url: width: 600 | image_tag: loading: 'lazy', alt: p.title }}</a>
        <h2 class="oasis-landing__name"><a href="{{ p.url }}">{{ p.title | escape }}</a></h2>
        <p class="oasis-landing__price">{% if p.price_varies %}From {% endif %}{{ p.price | money }}{% if p.compare_at_price > p.price %}<s>{{ p.compare_at_price | money }}</s>{% endif %}</p>
        <p class="oasis-landing__stock">{% if p.available %}In stock{% else %}Sold out{% endif %}</p>
      </article>
    {%- endif -%}`;
}

export interface LandingDraft {
  slug: string;
  title: string; // the page's title in Shopify
  files: LandingFile[];
}

export function buildLandingFiles(copy: LandingCopy, products: LandingProduct[], campaign?: LandingCampaign): LandingDraft {
  const known = new Set(products.map((p) => p.handle));
  for (const h of copy.productHandles) {
    if (!handleSchema.safeParse(h).success) throw new AppError("INVALID_INPUT", `"${h}" is not a product handle.`);
    if (!known.has(h)) throw new AppError("INVALID_INPUT", `There is no product with the handle "${h}" in this store.`);
  }
  const first = products.find((p) => p.handle === copy.productHandles[0]);
  const slug = slugify(campaign ? campaign.title : (copy.productHandles[0] ?? "page"));
  const name = campaign ? campaign.title : (first?.title ?? slug);
  const title = `${name} landing page`.slice(0, 120);

  const range = campaign ? dateRange(campaign.dateFrom, campaign.dateTo) : "";
  const eyebrow = campaign ? `    <p class="oasis-landing__eyebrow">${esc(campaign.title)}${range ? ` &middot; ${esc(range)}` : ""}</p>\n` : "";

  const section = `{%- comment -%}
  Made by Oasis. The words are fixed text. Prices and stock are read from the store each time the page loads.
  Review it, then publish the page in the Shopify admin.
{%- endcomment -%}
<section class="oasis-landing">
  <header class="oasis-landing__hero">
${eyebrow}    <h1 class="oasis-landing__headline">${esc(copy.headline)}</h1>
    <p class="oasis-landing__subhead">${esc(copy.subhead)}</p>
    <ul class="oasis-landing__bullets">
${copy.bullets.map((b) => `      <li>${esc(b)}</li>`).join("\n")}
    </ul>
    <a class="oasis-landing__cta" href="#oasis-products">${esc(copy.ctaLabel)}</a>
  </header>
  <div class="oasis-landing__grid" id="oasis-products">
${copy.productHandles.map(card).join("\n")}
  </div>
</section>

{% stylesheet %}
${CSS}
{% endstylesheet %}

{% schema %}
{
  "name": "Oasis landing page",
  "settings": []
}
{% endschema %}
`;

  const template =
    JSON.stringify({ sections: { main: { type: `oasis-landing-${slug}`, settings: {} } }, order: ["main"] }, null, 2) + "\n";

  return { slug, title, files: [{ path: sectionPath(slug), content: section }, { path: templatePath(slug), content: template }] };
}
