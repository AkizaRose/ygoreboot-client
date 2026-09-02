export interface CardData {
    id: number;
    name: string;
    // The name this card counts as for deck-building copy-limit
    // purposes (3-of, Legend 1-of, etc.) — NOT what's printed/rendered
    // on the card itself, which always uses `name`. Optional and absent
    // for the overwhelming majority of cards, where the printed name IS
    // the limit name. Only needs setting for cards whose own text says
    // something like "This card's name is always treated as X" (e.g.
    // Harpie Lady 1/2/3, all treatedAsName: "Harpie Lady") — every such
    // card, and the literal "Harpie Lady" itself if it exists, then
    // share one 3-copy pool rather than each getting their own.
    // Alternate-artwork entries never need this set explicitly: they
    // already share the same `name` as each other (deliberately, since
    // that's what's actually printed on each), so they're already
    // grouped correctly by that alone.
    treatedAsName?: string;
    cardClass: string;
    cardSubclass?: string;
    attribute: string;
    monsterType?: string;
    monsterSubclass?: string;
    level?: number;
    atk?: string;
    def?: string;
    artwork: string;
    frame: string;
    legend: string;
    effectText: string;
    flavourText?: string;
  }