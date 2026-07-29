import type { CardData } from '../../types/Card';
import {
  attributeImages,
  frameImages,
  spellTrapIconImages,
  limitImages,
  borderImg,
  levelImg,
  divLineImg,
  capitalize,
} from './cardAssets';
import './Card.css';

interface CardProps {
  card: CardData;
}

// From Card.css: .level1 is rightmost at left:679px, each slot moving left
// steps 54px (.level2 = 625, .level3 = 571, ...). Only 5 slots are defined
// in the CSS (matches the current data, max level 5), so slots beyond that
// are positioned by extending the same step programmatically.
const LEVEL_SLOT_RIGHTMOST_LEFT = 679;
const LEVEL_SLOT_STEP = 54;
const LEVEL_SLOT_TOP = 145;
const LEVEL_SLOT_SIZE = 49;
const LEVEL_DEFINED_SLOTS = 5;

function Card({ card }: CardProps) {
  const isMonster = card.cardClass === 'Monster';
  const isSpellOrTrap = card.cardClass === 'Spell' || card.cardClass === 'Trap';

  const frameSrc = frameImages[capitalize(card.frame)];
  const attributeSrc = attributeImages[card.attribute];
  const artworkSrc = `/artwork/${card.artwork}`;
  const limitSrc =
    card.limit === 1 || card.limit === 2 ? limitImages[String(card.limit)] : undefined;

  const spellTrapIconSrc =
    isSpellOrTrap && card.cardSubclass && card.cardSubclass !== 'Normal'
      ? spellTrapIconImages[card.cardSubclass]
      : undefined;

  // Rendered as separate spans (bracket / separator / text) rather than a
  // single string, so the gaps around "[", "]", and "/" can be tuned
  // precisely in CSS (see .types .bracket / .types .separator in Card.css)
  // instead of relying on the font's regular space-glyph width.
  const typeLineParts = (() => {
    if (!isMonster) return [];
    const parts = [card.monsterType];
    if (card.cardSubclass && card.cardSubclass !== 'Normal') parts.push(card.cardSubclass);
    if (card.monsterSubclass) parts.push(card.monsterSubclass);
    return parts.filter(Boolean);
  })();

  // "[ SPELL CARD ]" / "[ TRAP CARD ]" for Normal Spells/Traps, or the same
  // with trailing padding ("[ SPELL CARD     ]") to leave room for the
  // subclass icon (Continuous, Equip, etc.) rendered on top of it.
  const spellTrapTypeLine = isSpellOrTrap
    ? card.cardSubclass && card.cardSubclass !== 'Normal'
      ? `[ ${card.cardClass} Card\u00A0\u00A0\u00A0\u00A0\u00A0 ]`
      : `[ ${card.cardClass} Card ]`
    : '';

  const showMonsterEffect = isMonster && !!card.effectText;
  const showFlavourText = isMonster && !card.effectText && !!card.flavourText;

  const renderMultiline = (text: string) =>
    text.split('\n').map((line, i, arr) => (
      <span key={i}>
        {line}
        {i < arr.length - 1 && <br />}
      </span>
    ));

  return (
    <div className="Card">
      <img className="border" src={borderImg} alt="" />
      <img className="artwork" src={artworkSrc} alt={card.name} />
      {frameSrc && <img className="frame" src={frameSrc} alt="" />}

      <div className="name">{card.name}</div>

      {attributeSrc && (
        <img className="attribute" src={attributeSrc} alt={card.attribute} />
      )}

      {isMonster &&
        card.level != null &&
        Array.from({ length: card.level }, (_, i) => i + 1).map((slot) => (
          <img
            key={slot}
            className={slot <= LEVEL_DEFINED_SLOTS ? `level${slot}` : undefined}
            src={levelImg}
            alt="Level"
            style={
              slot > LEVEL_DEFINED_SLOTS
                ? {
                    position: 'absolute',
                    left: LEVEL_SLOT_RIGHTMOST_LEFT - (slot - 1) * LEVEL_SLOT_STEP,
                    top: LEVEL_SLOT_TOP,
                    width: LEVEL_SLOT_SIZE,
                    height: LEVEL_SLOT_SIZE,
                    zIndex: 32,
                  }
                : undefined
            }
          />
        ))}

      {isSpellOrTrap && <div className="spellTrapType">{spellTrapTypeLine}</div>}
      {spellTrapIconSrc && (
        <img className="spellTrapIcon" src={spellTrapIconSrc} alt={card.cardSubclass} />
      )}

      {isMonster && (
        <div className="types">
          <span className="bracket">[</span>
          {typeLineParts.map((part, i) => (
            <span key={`${part}-${i}`}>
              {i > 0 && <span className="separator">/</span>}
              {part}
            </span>
          ))}
          <span className="bracket">]</span>
        </div>
      )}

      {showMonsterEffect && (
        <div className="monsterEffect">{renderMultiline(card.effectText)}</div>
      )}
      {showFlavourText && <div className="flavourText">{card.flavourText}</div>}
      {isSpellOrTrap && card.effectText && (
        <div className="spellTrapEffect">{renderMultiline(card.effectText)}</div>
      )}

      {isMonster && <img className="divLine" src={divLineImg} alt="" />}

      {isMonster && (
        <>
          <div className="atkLabel">
            <span className="statText">ATK</span>
            <span className="statSlash">/</span>
          </div>
          <div className="atkValue">{card.atk}</div>
          <div className="defLabel">
            <span className="statText">DEF</span>
            <span className="statSlash">/</span>
          </div>
          <div className="defValue">{card.def}</div>
        </>
      )}

      {limitSrc && <img className="limit" src={limitSrc} alt={`Limit ${card.limit}`} />}
    </div>
  );
}

export default Card;
