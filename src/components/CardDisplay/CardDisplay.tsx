import CardImage from '../CardView/CardImage';
import type { CardData } from '../../types/Card';
import './CardDisplay.css';

// Reuses the same 813x1185-native-size-then-scale technique as
// CardBrowser/DeckBuilder, just at a larger SCALE for a proper preview.
const CARD_WIDTH = 813;
const CARD_HEIGHT = 1185;
const SCALE = 0.32;

interface CardDisplayProps {
  card: CardData | null;
}

function CardDisplay({ card }: CardDisplayProps) {
  const displayWidth = CARD_WIDTH * SCALE;

  // No card hovered yet (nothing has been hovered this session) — render
  // an empty placeholder at the same width, so the layout doesn't jump
  // once the first hover happens.
  if (!card) {
    return <div className="CardDisplay" style={{ width: displayWidth }} />;
  }

  const text = card.effectText || card.flavourText || '';

  return (
    <div className="CardDisplay" style={{ width: displayWidth }}>
      <div
        className="CardDisplay-imageWrapper"
        style={{ width: displayWidth, height: CARD_HEIGHT * SCALE }}
      >
        <div
          className="CardDisplay-cardWrapper"
          style={{
            width: CARD_WIDTH,
            height: CARD_HEIGHT,
            transform: `scale(${SCALE})`,
          }}
        >
          <CardImage card={card} />
        </div>
      </div>
      <div className="CardDisplay-text">{text}</div>
    </div>
  );
}

export default CardDisplay;
