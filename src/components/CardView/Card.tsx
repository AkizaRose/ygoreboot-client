import { useLayoutEffect, useRef, useState } from 'react';
import type { CardData } from '../../types/Card';
import {
  attributeImages,
  frameImages,
  spellTrapIconImages,
  limitImages,
  borderImg,
  levelImg,
  divLineImg,
} from './cardAssets';
import './Card.css';

interface CardProps {
  card: CardData;
}

// From Card.css: .name starts at left: 61.82px, and .attribute (the icon in
// the top-right corner) starts at left: 680px. The name has to stay clear
// of that icon, so its available width is the gap between the two, minus a
// small buffer.
const NAME_LEFT = 61.82;
const NAME_MAX_WIDTH = 680 - NAME_LEFT - 8;

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

  const frameSrc = frameImages[(card.frame)];
  const attributeSrc = attributeImages[card.attribute];
  const artworkSrc = `/artwork/${card.artwork}`;
  const limitSrc =
    card.limit === 1 || card.limit === 2 ? limitImages[String(card.limit)] : undefined;

  const spellTrapIconSrc =
    isSpellOrTrap && card.cardSubclass && card.cardSubclass !== 'Normal'
      ? spellTrapIconImages[card.cardSubclass]
      : undefined;

  // Long names get condensed horizontally (letters narrower, same height)
  // rather than wrapping or shrinking font-size, matching how real cards
  // handle long titles. We measure the name's natural, unscaled width and,
  // if it's wider than the available space, squeeze it back down with a
  // scaleX() transform anchored to the left edge (so the name still starts
  // at the same spot and only gets narrower toward the right).
  const nameRef = useRef<HTMLDivElement>(null);
  const [nameScaleX, setNameScaleX] = useState(1);

  useLayoutEffect(() => {
    const el = nameRef.current;
    if (!el) return;
    el.style.transform = 'none'; // reset so scrollWidth reflects natural width
    const naturalWidth = el.scrollWidth;
    setNameScaleX(naturalWidth > NAME_MAX_WIDTH ? NAME_MAX_WIDTH / naturalWidth : 1);
  }, [card.name]);

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

  const hasSpellTrapIcon = isSpellOrTrap && !!card.cardSubclass && card.cardSubclass !== 'Normal';

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

      <div
        ref={nameRef}
        className={isSpellOrTrap ? 'name name--light' : 'name'}
        style={{ transform: `scaleX(${nameScaleX})`, transformOrigin: 'left center', whiteSpace: 'nowrap' }}
      >
        {card.name}
      </div>

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

      {isSpellOrTrap && (
        <div className="spellTrapType">
          <span className="bracket">[</span>
          <span className="statText">{card.cardClass} Card</span>
          {hasSpellTrapIcon && <span className="iconGap" />}
          <span className="bracket">]</span>
        </div>
      )}
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
          </div>
          <div className="atkValue">{card.atk}</div>
          <div className="defLabel">
            <span className="statText">DEF</span>
          </div>
          <div className="defValue">{card.def}</div>
        </>
      )}

      {limitSrc && <img className="limit" src={limitSrc} alt={`Limit ${card.limit}`} />}
    </div>
  );
}

export default Card;
