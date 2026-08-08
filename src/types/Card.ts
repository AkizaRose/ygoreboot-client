export interface CardData {
    id: number;
    name: string;
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
