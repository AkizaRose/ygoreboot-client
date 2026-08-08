import Card from './Card';
import type { CardData } from '../../types/Card';
import { useRasterizedCard, CARD_WIDTH, CARD_HEIGHT } from './useRasterizedCard';
import './CardImage.css';

interface CardImageProps {
  card: CardData;
}

// Renders the same visual result as <Card card={card} />, but backed by a
// cached, rasterized PNG once one exists for this card — filling the same
// 813x1185 box either way, so callers (e.g. CardBrowser's scale wrapper)
// don't need to know or care which is currently showing.
function CardImage({ card }: CardImageProps) {
  const { imageUrl, captureRef, needsCapture } = useRasterizedCard(card);

  if (imageUrl) {
    return <img src={imageUrl} alt={card.name} className="CardImage-raster" />;
  }

  return (
    <>
      {/* Visible immediately: the live, fully-styled component, while the
          rasterized version is still being captured. */}
      <Card card={card} />

      {needsCapture && (
        <div className="CardImage-captureStage" aria-hidden="true">
          <div
            ref={captureRef}
            className="CardImage-captureNode"
            style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
          >
            <Card card={card} />
          </div>
        </div>
      )}
    </>
  );
}

export default CardImage;
