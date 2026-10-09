import type { Skill } from "@/lib/domain/types";

export interface KnowledgePointSeed {
  key: string;
  title: string;
  category: "grammar" | "spelling" | "discourse" | "comprehension";
  skill: Skill;
  cefrLevel: "A2" | "B1" | "B2";
  ruleSummary: string;
  examples: string[];
}

const PROVENANCE = "Original summary written for this project (curated layer, v1).";
export const KNOWLEDGE_POINT_PROVENANCE = PROVENANCE;

export const KNOWLEDGE_POINTS: KnowledgePointSeed[] = [
  {
    key: "pc_auxiliary",
    title: "Passé composé : avoir ou être",
    category: "grammar",
    skill: "writing",
    cefrLevel: "A2",
    ruleSummary:
      "Most verbs form the passé composé with avoir. Être is used with all reflexive verbs and with a closed set of movement / change-of-state verbs (aller, venir, arriver, partir, entrer, sortir, monter, descendre, naître, mourir, rester, tomber, retourner and compounds such as revenir, devenir).",
    examples: ["J'ai travaillé hier.", "Elle est partie à huit heures.", "Nous nous sommes levés tôt."],
  },
  {
    key: "pp_agreement",
    title: "Accord du participe passé",
    category: "grammar",
    skill: "writing",
    cefrLevel: "B1",
    ruleSummary:
      "With être, the past participle agrees in gender and number with the subject. With avoir, it agrees only with a direct object placed before the verb (often via que or a pronoun).",
    examples: ["Elles sont arrivées.", "Les lettres que j'ai écrites.", "J'ai écrit les lettres."],
  },
  {
    key: "imparfait_vs_pc",
    title: "Imparfait ou passé composé",
    category: "grammar",
    skill: "writing",
    cefrLevel: "B1",
    ruleSummary:
      "The imparfait describes background, habits and ongoing states in the past. The passé composé presents completed events that move the story forward.",
    examples: ["Il pleuvait quand je suis sorti.", "Quand j'étais petit, je jouais au soccer."],
  },
  {
    key: "subjonctif_present",
    title: "Subjonctif présent",
    category: "grammar",
    skill: "writing",
    cefrLevel: "B1",
    ruleSummary:
      "Use the subjunctive after que following expressions of necessity, wish, emotion or doubt when the subject changes (il faut que, vouloir que, il est important que), and after conjunctions such as bien que, avant que, pour que.",
    examples: ["Il faut que tu fasses tes devoirs.", "Je veux que vous veniez.", "Bien qu'il soit tard, je continue."],
  },
  {
    key: "conditionnel_present",
    title: "Conditionnel présent",
    category: "grammar",
    skill: "writing",
    cefrLevel: "B1",
    ruleSummary:
      "Formed with the future stem plus imparfait endings (-ais, -ais, -ait, -ions, -iez, -aient). Used for polite requests, wishes, advice and hypotheses. Do not confuse j'aimerais (conditional) with j'aimerai (future).",
    examples: ["Je voudrais un café.", "Tu devrais te reposer.", "J'aimerais un renseignement."],
  },
  {
    key: "si_clauses",
    title: "Phrases hypothétiques avec si",
    category: "grammar",
    skill: "writing",
    cefrLevel: "B1",
    ruleSummary:
      "si + présent → futur (real condition); si + imparfait → conditionnel présent (hypothesis). Never put the future or the conditional directly after si in these structures.",
    examples: ["S'il pleut, nous resterons à la maison.", "Si j'avais le temps, je voyagerais."],
  },
  {
    key: "pronoms_cod_coi",
    title: "Pronoms COD et COI",
    category: "grammar",
    skill: "writing",
    cefrLevel: "A2",
    ruleSummary:
      "Direct object pronouns (le, la, l', les) replace a noun with no preposition; indirect object pronouns (lui, leur) replace à + person. They go before the conjugated verb, or before the infinitive when there is one.",
    examples: ["Je la vois.", "Je lui parle.", "Je vais les appeler."],
  },
  {
    key: "pronoms_y_en",
    title: "Les pronoms y et en",
    category: "grammar",
    skill: "writing",
    cefrLevel: "B1",
    ruleSummary:
      "y replaces à + thing or a place; en replaces de + noun, partitive articles and quantities (the number stays at the end).",
    examples: ["J'y vais demain.", "J'en ai trois.", "Du café ? Oui, j'en veux bien."],
  },
  {
    key: "pronoms_relatifs",
    title: "Pronoms relatifs qui, que, dont, où",
    category: "grammar",
    skill: "writing",
    cefrLevel: "B1",
    ruleSummary:
      "qui is the subject of the relative clause, que the direct object, dont replaces de + noun, and où refers to a place or a time.",
    examples: ["La femme qui parle est ma voisine.", "Le livre dont je parle.", "La ville où j'habite."],
  },
  {
    key: "articles_partitifs",
    title: "Articles partitifs et négation",
    category: "grammar",
    skill: "writing",
    cefrLevel: "A2",
    ruleSummary:
      "Use du, de la, de l', des for unspecified quantities. After a negation they become de / d' (except after être).",
    examples: ["Je bois du café.", "Je ne bois pas de café.", "Ce n'est pas du sucre."],
  },
  {
    key: "prepositions_lieux",
    title: "Prépositions avec les villes et les pays",
    category: "grammar",
    skill: "writing",
    cefrLevel: "A2",
    ruleSummary:
      "à + city; en + feminine country or country starting with a vowel; au + masculine country; aux + plural country.",
    examples: ["J'habite à Montréal, au Canada.", "Elle va en France.", "Ils vivent aux États-Unis."],
  },
  {
    key: "accord_adjectifs",
    title: "Accord et place des adjectifs",
    category: "grammar",
    skill: "writing",
    cefrLevel: "A2",
    ruleSummary:
      "Adjectives agree in gender and number with the noun. Most follow the noun; a short list (beau, bon, grand, petit, jeune, vieux, nouveau, joli, mauvais) usually precedes it.",
    examples: ["une petite maison blanche", "des idées intéressantes", "une nouvelle voiture"],
  },
  {
    key: "futur_simple",
    title: "Futur simple",
    category: "grammar",
    skill: "writing",
    cefrLevel: "A2",
    ruleSummary:
      "Infinitive (minus a final -e) + -ai, -as, -a, -ons, -ez, -ont. Common irregular stems: ser-, aur-, ir-, fer-, pourr-, viendr-, devr-, verr-, enverr-.",
    examples: ["Je finirai demain.", "Nous serons prêts.", "Ils viendront la semaine prochaine."],
  },
  {
    key: "connecteurs_logiques",
    title: "Connecteurs logiques",
    category: "discourse",
    skill: "writing",
    cefrLevel: "B1",
    ruleSummary:
      "Structure an argument with connectors: addition (de plus, en outre), opposition (cependant, pourtant, en revanche), cause (car, puisque), consequence (donc, par conséquent).",
    examples: ["Le loyer est élevé ; cependant, le quartier est calme.", "Il a beaucoup travaillé, donc il a réussi."],
  },
  {
    key: "comparatifs",
    title: "Comparatifs",
    category: "grammar",
    skill: "writing",
    cefrLevel: "A2",
    ruleSummary:
      "plus / moins / aussi + adjective or adverb + que. Irregular forms: bon → meilleur (adjective), bien → mieux (adverb).",
    examples: ["Ce film est meilleur que l'autre.", "Il parle mieux que moi."],
  },
  {
    key: "orthographe_accents",
    title: "Orthographe et accents",
    category: "spelling",
    skill: "writing",
    cefrLevel: "A2",
    ruleSummary:
      "Accents change pronunciation and sometimes meaning (a / à, ou / où, du / dû). Past participles of -er verbs end in -é.",
    examples: ["Il a mangé.", "Où est la gare ?", "Il va à Québec."],
  },
  {
    key: "reading_main_idea",
    title: "Compréhension : idée principale",
    category: "comprehension",
    skill: "reading",
    cefrLevel: "A2",
    ruleSummary:
      "Identify who is writing, to whom, and why. The main idea is usually stated near the beginning or in the request / conclusion.",
    examples: [],
  },
  {
    key: "reading_detail",
    title: "Compréhension : information précise",
    category: "comprehension",
    skill: "reading",
    cefrLevel: "A2",
    ruleSummary:
      "Locate a specific piece of information (date, price, condition). Beware of distractors that reuse words from the text with a different meaning.",
    examples: [],
  },
];

export const KNOWLEDGE_POINT_KEYS = new Set(KNOWLEDGE_POINTS.map((k) => k.key));
