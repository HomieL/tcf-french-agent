import type { ExerciseContent } from "@/lib/domain/exercise";

/**
 * Seed exercise bank: original items written for this project. Used by the mock provider and as a
 * per-item fallback when generated exercises fail validation.
 */
export interface BankExercise {
  id: string;
  concept: string;
  cefrLevel: "A2" | "B1" | "B2";
  difficulty: number;
  content: ExerciseContent;
}

const FILL = "Complétez la phrase.";
const TRANSLATE = "Traduisez en français.";
const CORRECT = "Corrigez la phrase.";
const READ = "Lisez le texte et choisissez la bonne réponse.";

function fill(id: string, concept: string, cefrLevel: BankExercise["cefrLevel"], difficulty: number, prompt: string, acceptedAnswers: string[], hint?: string): BankExercise {
  return { id, concept, cefrLevel, difficulty, content: { type: "fill_blank", instructions: FILL, prompt, acceptedAnswers, hint: hint ?? null } };
}
function translate(id: string, concept: string, cefrLevel: BankExercise["cefrLevel"], difficulty: number, prompt: string, acceptedAnswers: string[], hint?: string): BankExercise {
  return { id, concept, cefrLevel, difficulty, content: { type: "translation", instructions: TRANSLATE, prompt, acceptedAnswers, hint: hint ?? null } };
}
function correct(id: string, concept: string, cefrLevel: BankExercise["cefrLevel"], difficulty: number, prompt: string, acceptedAnswers: string[], hint?: string): BankExercise {
  return { id, concept, cefrLevel, difficulty, content: { type: "sentence_correction", instructions: CORRECT, prompt, acceptedAnswers, hint: hint ?? null } };
}

export const DRILL_BANK: BankExercise[] = [
  // pc_auxiliary
  fill("pc1", "pc_auxiliary", "A2", 0.3, "Hier, nous ___ (aller) au cinéma.", ["sommes allés", "sommes allées"], "Aller est un verbe de mouvement."),
  correct("pc2", "pc_auxiliary", "A2", 0.35, "Je suis travaillé jusqu'à 18 heures.", ["J'ai travaillé jusqu'à 18 heures.", "J'ai travaillé jusqu'à 18 h."]),
  translate("pc3", "pc_auxiliary", "A2", 0.4, "She left at eight o'clock.", ["Elle est partie à huit heures.", "Elle est partie à 8 heures.", "Elle est partie à 8 h."]),
  // pp_agreement
  fill("pp1", "pp_agreement", "B1", 0.4, "Mes sœurs sont ___ (arriver) ce matin.", ["arrivées"]),
  correct("pp2", "pp_agreement", "B1", 0.6, "Les photos que j'ai pris sont belles.", ["Les photos que j'ai prises sont belles."], "Où est le COD ?"),
  fill("pp3", "pp_agreement", "B1", 0.5, "Marie s'est ___ (lever) tôt.", ["levée"]),
  // imparfait_vs_pc
  fill("ip1", "imparfait_vs_pc", "B1", 0.4, "Quand j'___ (être) enfant, j'habitais à Lyon.", ["étais"]),
  fill("ip2", "imparfait_vs_pc", "B1", 0.5, "Il pleuvait quand nous ___ (sortir).", ["sommes sortis", "sommes sorties"]),
  translate("ip3", "imparfait_vs_pc", "B1", 0.55, "I was reading when the phone rang.", ["Je lisais quand le téléphone a sonné.", "Je lisais lorsque le téléphone a sonné."]),
  // subjonctif_present
  fill("sj1", "subjonctif_present", "B1", 0.45, "Il faut que tu ___ (faire) tes devoirs.", ["fasses"]),
  correct("sj2", "subjonctif_present", "B1", 0.5, "Je veux que tu viens avec moi.", ["Je veux que tu viennes avec moi."]),
  fill("sj3", "subjonctif_present", "B1", 0.6, "Bien qu'il ___ (être) fatigué, il continue.", ["soit"]),
  // conditionnel_present
  fill("cd1", "conditionnel_present", "B1", 0.3, "Je ___ (vouloir) réserver une table pour deux.", ["voudrais"]),
  translate("cd2", "conditionnel_present", "B1", 0.4, "You should rest.", ["Tu devrais te reposer.", "Vous devriez vous reposer."]),
  correct("cd3", "conditionnel_present", "B1", 0.5, "J'aimerai un renseignement, s'il vous plaît.", ["J'aimerais un renseignement, s'il vous plaît."], "Demande polie."),
  // si_clauses
  fill("si1", "si_clauses", "B1", 0.45, "Si j'avais plus de temps, je ___ (voyager) davantage.", ["voyagerais"]),
  correct("si2", "si_clauses", "B1", 0.55, "Si j'aurais de l'argent, j'achèterais une maison.", ["Si j'avais de l'argent, j'achèterais une maison."]),
  fill("si3", "si_clauses", "B1", 0.4, "S'il fait beau demain, nous ___ (aller) au parc.", ["irons"]),
  // pronoms_cod_coi
  fill("po1", "pronoms_cod_coi", "A2", 0.35, "Tu parles à ta mère ? Oui, je ___ parle tous les jours.", ["lui"]),
  correct("po2", "pronoms_cod_coi", "A2", 0.45, "Ces livres ? Je vais lire les ce soir.", ["Ces livres ? Je vais les lire ce soir."]),
  translate("po3", "pronoms_cod_coi", "A2", 0.4, "I call them every Sunday.", ["Je les appelle tous les dimanches.", "Je les appelle chaque dimanche."]),
  // pronoms_y_en
  fill("ye1", "pronoms_y_en", "B1", 0.35, "Tu vas à Québec ? Oui, j'___ vais en juillet.", ["y"]),
  fill("ye2", "pronoms_y_en", "B1", 0.4, "Combien de frères as-tu ? J'___ ai deux.", ["en"]),
  correct("ye3", "pronoms_y_en", "B1", 0.5, "Du café ? Oui, j'y veux bien.", ["Du café ? Oui, j'en veux bien."]),
  // pronoms_relatifs
  fill("pr1", "pronoms_relatifs", "B1", 0.55, "C'est le film ___ je t'ai parlé.", ["dont"]),
  fill("pr2", "pronoms_relatifs", "B1", 0.35, "La ville ___ j'habite est très calme.", ["où"]),
  correct("pr3", "pronoms_relatifs", "B1", 0.4, "La femme que parle est ma voisine.", ["La femme qui parle est ma voisine."]),
  // articles_partitifs
  fill("ap1", "articles_partitifs", "A2", 0.25, "Le matin, je bois ___ café.", ["du"]),
  correct("ap2", "articles_partitifs", "A2", 0.35, "Je ne mange pas du viande.", ["Je ne mange pas de viande."]),
  translate("ap3", "articles_partitifs", "A2", 0.4, "We don't have any bread.", ["Nous n'avons pas de pain.", "On n'a pas de pain."]),
  // prepositions_lieux
  fill("pl1", "prepositions_lieux", "A2", 0.25, "Mon frère habite ___ Canada.", ["au"]),
  fill("pl2", "prepositions_lieux", "A2", 0.3, "Nous partons ___ Italie cet été.", ["en"]),
  correct("pl3", "prepositions_lieux", "A2", 0.3, "Je travaille en Toronto.", ["Je travaille à Toronto."]),
  // accord_adjectifs
  fill("aa1", "accord_adjectifs", "A2", 0.3, "Elle a acheté une ___ (nouveau) voiture.", ["nouvelle"]),
  correct("aa2", "accord_adjectifs", "A2", 0.3, "C'est une idée intéressant.", ["C'est une idée intéressante."]),
  translate("aa3", "accord_adjectifs", "A2", 0.45, "They are small white houses.", ["Ce sont de petites maisons blanches.", "Ce sont des petites maisons blanches."]),
  // futur_simple
  fill("fs1", "futur_simple", "A2", 0.3, "Demain, nous ___ (être) à Montréal.", ["serons"]),
  fill("fs2", "futur_simple", "A2", 0.45, "Je te ___ (envoyer) le document ce soir.", ["enverrai"]),
  translate("fs3", "futur_simple", "A2", 0.4, "They will come next week.", ["Ils viendront la semaine prochaine.", "Elles viendront la semaine prochaine."]),
  // connecteurs_logiques
  fill("cl1", "connecteurs_logiques", "B1", 0.45, "Le loyer est cher ; ___, l'appartement est bien situé.", ["cependant", "pourtant", "en revanche", "toutefois", "néanmoins"], "Il faut exprimer une opposition."),
  fill("cl2", "connecteurs_logiques", "B1", 0.4, "Il a beaucoup travaillé, ___ il a réussi son examen.", ["donc", "alors", "par conséquent", "c'est pourquoi"], "Il faut exprimer une conséquence."),
  // comparatifs
  fill("cp1", "comparatifs", "A2", 0.35, "Ce restaurant est ___ (bon) que l'autre.", ["meilleur"]),
  correct("cp2", "comparatifs", "A2", 0.4, "Elle parle français plus bien que moi.", ["Elle parle français mieux que moi.", "Elle parle mieux français que moi."]),
  translate("cp3", "comparatifs", "A2", 0.4, "Montreal is bigger than Quebec City.", ["Montréal est plus grande que Québec.", "Montréal est plus grand que Québec.", "Montréal est plus grande que la ville de Québec.", "Montréal est plus grand que la ville de Québec."]),
  // orthographe_accents
  correct("oa1", "orthographe_accents", "A2", 0.2, "Ou est la gare ?", ["Où est la gare ?"]),
  fill("oa2", "orthographe_accents", "A2", 0.2, "Hier, j'ai ___ (manger) avec des collègues.", ["mangé"]),
];

export const READING_BANK: BankExercise[] = [
  {
    id: "rd1",
    concept: "reading_main_idea",
    cefrLevel: "A2",
    difficulty: 0.3,
    content: {
      type: "reading_mcq",
      instructions: READ,
      passage:
        "Madame, Monsieur,\nJe vous écris pour signaler que le chauffage de mon appartement ne fonctionne plus depuis lundi. J'ai déjà appelé le concierge deux fois, mais personne n'est venu. Je vous demande d'envoyer un technicien le plus rapidement possible.\nCordialement,\nJulie Martin",
      prompt: "Pourquoi Julie Martin écrit-elle ?",
      options: ["Pour remercier le concierge", "Pour demander une réparation", "Pour annoncer son déménagement", "Pour payer son loyer"],
      correctOption: 1,
      hint: null,
    },
  },
  {
    id: "rd2",
    concept: "reading_detail",
    cefrLevel: "A2",
    difficulty: 0.35,
    content: {
      type: "reading_mcq",
      instructions: READ,
      passage:
        "Bibliothèque municipale — horaires d'été. Du 1er juillet au 31 août, la bibliothèque est ouverte du mardi au samedi, de 10 h à 17 h. Elle est fermée le dimanche et le lundi. L'emprunt de livres est gratuit pour les résidents ; les non-résidents paient 20 $ par an.",
      prompt: "Combien paie un non-résident pour emprunter des livres ?",
      options: ["Rien", "10 $ par mois", "20 $ par an", "17 $ par an"],
      correctOption: 2,
      hint: null,
    },
  },
  {
    id: "rd3",
    concept: "reading_detail",
    cefrLevel: "A2",
    difficulty: 0.4,
    content: {
      type: "reading_mcq",
      instructions: READ,
      passage:
        "Offre d'emploi : le café Soleil cherche un serveur ou une serveuse à temps partiel pour les fins de semaine. Un an d'expérience est exigé. Le poste demande de parler français et anglais. Envoyez votre CV avant le 15 octobre.",
      prompt: "Quelle condition est obligatoire ?",
      options: ["Travailler à temps plein", "Avoir un an d'expérience", "Parler espagnol", "Habiter près du café"],
      correctOption: 1,
      hint: null,
    },
  },
  {
    id: "rd4",
    concept: "reading_main_idea",
    cefrLevel: "B1",
    difficulty: 0.45,
    content: {
      type: "reading_mcq",
      instructions: READ,
      passage:
        "Depuis quelques années, de plus en plus de Montréalais choisissent le vélo pour aller au travail. La ville a construit de nouvelles pistes cyclables, et le service de vélos en libre-service a battu des records cet été. Cependant, certains cyclistes demandent encore plus de sécurité en hiver.",
      prompt: "Quel est le sujet principal du texte ?",
      options: [
        "La popularité croissante du vélo à Montréal",
        "Les accidents de voiture en hiver",
        "Le prix des transports en commun",
        "La fermeture des pistes cyclables",
      ],
      correctOption: 0,
      hint: null,
    },
  },
];

function writing(id: string, concept: string, cefrLevel: BankExercise["cefrLevel"], difficulty: number, prompt: string, minWords: number, maxWords: number, requiredElements: string[]): BankExercise {
  return {
    id,
    concept,
    cefrLevel,
    difficulty,
    content: { type: "short_writing", instructions: "Écrivez un court texte en français.", prompt, minWords, maxWords, requiredElements, hint: null },
  };
}

export const WRITING_BANK: BankExercise[] = [
  writing("wr1", "pc_auxiliary", "A2", 0.4, "Racontez votre dernière fin de semaine : où êtes-vous allé(e) et qu'avez-vous fait ?", 40, 80, ["au moins trois verbes au passé composé", "un lieu"]),
  writing("wr2", "conditionnel_present", "B1", 0.5, "Écrivez un courriel à votre propriétaire pour demander poliment une réparation dans votre appartement.", 50, 90, ["une formule de salutation", "la description du problème", "une demande polie au conditionnel"]),
  writing("wr3", "connecteurs_logiques", "B1", 0.6, "Êtes-vous pour ou contre le télétravail ? Donnez votre opinion avec deux arguments.", 60, 120, ["une opinion claire", "deux arguments", "au moins deux connecteurs logiques"]),
  writing("wr4", "si_clauses", "B1", 0.55, "Si vous pouviez vivre dans n'importe quelle ville du Canada, laquelle choisiriez-vous et pourquoi ?", 50, 90, ["une phrase avec si + imparfait", "une justification"]),
  writing("wr5", "imparfait_vs_pc", "B1", 0.55, "Décrivez un souvenir d'enfance : où étiez-vous, que faisiez-vous, et que s'est-il passé ?", 50, 100, ["le contexte à l'imparfait", "un événement au passé composé"]),
  writing("wr6", "subjonctif_present", "B1", 0.55, "Un ami arrive au Canada. Donnez-lui trois conseils avec « il faut que » ou « il est important que ».", 40, 80, ["trois conseils", "le subjonctif après il faut que / il est important que"]),
];

export const REFLECTION_CONTENT: ExerciseContent = {
  type: "reflection",
  instructions: "Réflexion",
  prompt:
    "En une ou deux phrases, qu'avez-vous appris ou trouvé difficile aujourd'hui ? (Vous pouvez écrire en français ou en anglais.)",
  hint: null,
};

export const ALL_BANK = [...DRILL_BANK, ...READING_BANK, ...WRITING_BANK];
