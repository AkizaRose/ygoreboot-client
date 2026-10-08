import { useLayoutEffect, useRef, useState } from 'react';
import type { CardData } from '../../types/Card';
import {
  attributeImages,
  frameImages,
  spellTrapIconImages,
  levelImg,
  legendImg,
  capitalize,
} from './cardAssetsClassic';
import './CardClassic.css';
import { useAutoFitText } from '../CardView/useAutoFitText';

interface CardClassicProps {
  card: CardData;
}

// From CardClassic.css: .name starts at left: 62px, and .attribute (the
// icon in the top-right corner) starts at left: 680px. The name has to
// stay clear of that icon, so its available width is the gap between the
// two, minus a small buffer.
const NAME_LEFT = 62;
const NAME_MAX_WIDTH = 680 - NAME_LEFT - 8;

// From CardClassic.css: .level1 is rightmost at left:679px, each slot
// moving left steps 54px (.level2 = 625, .level3 = 571, ...). Only 5
// slots are defined in the CSS (matches the current data, max level 5),
// so slots beyond that are positioned by extending the same step
// programmatically.
const LEVEL_SLOT_RIGHTMOST_LEFT = 679;
const LEVEL_SLOT_STEP = 54;
const LEVEL_SLOT_TOP = 145;
const LEVEL_SLOT_SIZE = 49;
const LEVEL_DEFINED_SLOTS = 5;

// From CardClassic.css: .monsterEffect and .spellTrapEffect share a fixed
// 28px base font-size but have different box heights (160px vs 221px) —
// useAutoFitText measures against whichever box is actually rendered, so
// the same shrink range works for both. The 1.06 max line-height matches
// the natural line spacing of the effect font at 28px (what the box
// looked like before auto-fit existed), so text that already fits renders
// exactly as it always did.
const EFFECT_MAX_FONT_SIZE = 28;
const EFFECT_MIN_FONT_SIZE = 16;
const EFFECT_MAX_LINE_HEIGHT = 1.15;
const EFFECT_MIN_LINE_HEIGHT = 0.9;

// The classic counterpart to CardView/Card.tsx — same card data in, same
// 813x1185 native size out, drawn in the classic layout (frame art with
// the artwork window, divider and border baked in, ATK/DEF as a plain
// text line, a row of stars for Level). All of its CSS is scoped under
// .CardClassic (see CardClassic.css) so it can't collide with Card.css's
// own class names.
function CardClassic({ card }: CardClassicProps) {
  const isMonster = card.cardClass === 'Monster';
  const isSpellOrTrap = card.cardClass === 'Spell' || card.cardClass === 'Trap';

  const frameSrc = frameImages[capitalize(card.frame)];
  const attributeSrc = attributeImages[card.attribute];
  const artworkSrc = `/artwork/${card.artwork}`;
  const isLegend = !!card.legend;

  const hasSpellTrapIcon = isSpellOrTrap && !!card.cardSubclass && card.cardSubclass !== 'Normal';
  const spellTrapIconSrc = hasSpellTrapIcon ? spellTrapIconImages[card.cardSubclass!] : undefined;

  // Long names get condensed horizontally (letters narrower, same height)
  // rather than wrapping or shrinking font-size — see Card.tsx for the
  // full explanation of this squash-to-fit logic and of why it re-measures
  // on the document's 'loadingdone' event rather than awaiting a promise.
  const nameRef = useRef<HTMLDivElement>(null);
  const [nameScaleX, setNameScaleX] = useState(1);

  useLayoutEffect(() => {
    const el = nameRef.current;
    if (!el) return;

    const measure = () => {
      el.style.transform = 'none'; // reset so scrollWidth reflects natural width
      const naturalWidth = el.scrollWidth;
      setNameScaleX(naturalWidth > NAME_MAX_WIDTH ? NAME_MAX_WIDTH / naturalWidth : 1);
    };

    measure();

    document.fonts.load('92px "MatrixRegularSmallCaps"');
    document.fonts.addEventListener('loadingdone', measure);

    return () => {
      document.fonts.removeEventListener('loadingdone', measure);
    };
  }, [card.name]);

  // Rendered as separate spans (bracket / separator / text) rather than a
  // single string, so the gaps around "[", "]", and "/" can be tuned
  // precisely in CSS (see .types .bracket / .types .separator in
  // CardClassic.css) instead of relying on the font's regular space-glyph
  // width.
  const typeLineParts = (() => {
    if (!isMonster) return [];
    const parts = [card.monsterType];
    if (card.cardSubclass && card.cardSubclass !== 'Normal') parts.push(card.cardSubclass);
    if (card.monsterSubclass) parts.push(card.monsterSubclass);
    return parts.filter(Boolean);
  })();

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
    <div className="CardClassic">
      <img className="artwork" src={artworkSrc} alt={card.name} />
      {frameSrc && <img className="frame" src={frameSrc} alt="" />}

      <div
        ref={nameRef}
        className={isSpellOrTrap ? 'name name--light' : 'name'}
        style={{ transform: `scaleX(${nameScaleX})`, transformOrigin: 'left center', whiteSpace: 'nowrap' }}
      >
        {card.name}
      </div>

      {attributeSrc && <img className="attribute" src={attributeSrc} alt={card.attribute} />}

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
                    zIndex: 28,
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

      {isLegend && <img className="legend" src={legendImg} alt="Legend" />}
    </div>
  );
}

export default CardClassic;
