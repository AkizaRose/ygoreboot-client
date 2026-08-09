import { useLayoutEffect, useRef, useState } from 'react';
import type { CardData } from '../../types/Card';
import {
  attributeImages,
  frameImages,
  spellTrapIconImages,
  levelImages,
  borderImg,
  spellTrapIconBgImg,
  atkDefLabelsImg,
  legendImg,
} from './cardAssets';
import './Card.css';
import { useAutoFitText } from './useAutoFitText';

interface CardProps {
  card: CardData;
}

// From Card.css: .name starts at left: 61.82px, and .attribute (the icon in
// the top-right corner) starts at left: 680px. The name has to stay clear
// of that icon, so its available width is the gap between the two, minus a
// small buffer.
const NAME_LEFT = 61.82;
const NAME_MAX_WIDTH = 680 - NAME_LEFT - 8;

// From Card.css: .monsterEffect and .spellTrapEffect share a fixed 28px
// base font-size and box height — the same shrink range works for both,
// since a card is only ever one or the other.
const EFFECT_MAX_FONT_SIZE = 28;
const EFFECT_MIN_FONT_SIZE = 16;
const EFFECT_MAX_LINE_HEIGHT = 1.15;
const EFFECT_MIN_LINE_HEIGHT = 0.85;

function Card({ card }: CardProps) {
  const isMonster = card.cardClass === 'Monster';
  const isSpellOrTrap = card.cardClass === 'Spell' || card.cardClass === 'Trap';

  const frameSrc = frameImages[(card.frame)];
  const attributeSrc = attributeImages[card.attribute];
  const artworkSrc = `/artwork/${card.artwork}`;
  const isLegend = !!card.legend;

  // One pre-composited image per Level value (level1.png..level5.png),
  // rather than stacking individual star images — Card.css already gives
  // .level1 through .level5 the same position/size, since only one of them
  // is ever rendered at a time.
  const levelSrc = isMonster && card.level != null ? levelImages[`level${card.level}`] : undefined;

  const spellTrapIconSrc =
    isSpellOrTrap && card.cardSubclass ? spellTrapIconImages[card.cardSubclass] : undefined;

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
    if (card.cardSubclass) parts.push(card.cardSubclass);
    if (card.monsterSubclass) parts.push(card.monsterSubclass);
    return parts.filter(Boolean);
  })();

  const hasSpellTrapIcon = isSpellOrTrap && !!card.cardSubclass;

  const showMonsterEffect = isMonster && !!card.effectText;
  const showFlavourText = isMonster && !card.effectText && !!card.flavourText;

  // Only one of monsterEffect/spellTrapEffect ever renders for a given
  // card, so a single ref/fontSize/lineHeight triple covers both.
  const {
    ref: effectTextRef,
    fontSize: effectFontSize,
    lineHeight: effectLineHeight,
  } = useAutoFitText<HTMLDivElement>([card.effectText], {
    maxFontSize: EFFECT_MAX_FONT_SIZE,
    minFontSize: EFFECT_MIN_FONT_SIZE,
    maxLineHeight: EFFECT_MAX_LINE_HEIGHT,
    minLineHeight: EFFECT_MIN_LINE_HEIGHT,
  });

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
      <div className="artworkBorder" />

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

      {levelSrc && (
        <img className={`level${card.level}`} src={levelSrc} alt={`Level ${card.level}`} />
      )}

      {isSpellOrTrap && (
        <div className="spellTrapType">
          <span className="bracket">[</span>
          <span className="statText">{card.cardClass}</span>
          {card.cardSubclass && (
            <>
              <span className="separator">/</span>
              <span className="statText">{card.cardSubclass}</span>
            </>
          )}
          {hasSpellTrapIcon && <span className="iconGap" />}
          <span className="bracket">]</span>
        </div>
      )}
      {spellTrapIconSrc && (
        <img className="spellTrapIconBG" src={spellTrapIconBgImg} alt="" />
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
        <div
          ref={effectTextRef}
          className="monsterEffect"
          style={{ fontSize: effectFontSize, lineHeight: effectLineHeight }}
        >
          {renderMultiline(card.effectText)}
        </div>
      )}
      {showFlavourText && <div className="flavourText">{card.flavourText}</div>}
      {isSpellOrTrap && card.effectText && (
        <div
          ref={effectTextRef}
          className="spellTrapEffect"
          style={{ fontSize: effectFontSize, lineHeight: effectLineHeight }}
        >
          {renderMultiline(card.effectText)}
        </div>
      )}

      {isMonster && (
        <>
          <img className="atkDefLabels" src={atkDefLabelsImg} alt="ATK / DEF" />
          <div className="atkValue">{card.atk}</div>
          <div className="defValue">{card.def}</div>
        </>
      )}

      {isLegend && <img className="legend" src={legendImg} alt="Legend" />}
    </div>
  );
}

export default Card;
