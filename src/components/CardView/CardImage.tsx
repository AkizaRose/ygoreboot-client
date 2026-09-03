import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
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

  // True for the brief window right after imageUrl first becomes
  // available, during which the raster image is faded in ON TOP of the
  // still-visible live card (rather than instantly replacing it) — false
  // once that fade finishes, at which point the live card is removed and
  // the raster image switches to its own normal, fill-the-parent sizing.
  // Initialized from imageUrl's OWN starting value (not hardcoded false)
  // so an already-cached card showing up for the first time renders
  // straight to its steady state, with no unwarranted fade-in.
  const [isTransitioning, setIsTransitioning] = useState(false);
  const previousImageUrlRef = useRef(imageUrl);

  useEffect(() => {
    if (imageUrl && !previousImageUrlRef.current) {
      setIsTransitioning(true);
    }
    previousImageUrlRef.current = imageUrl;
  }, [imageUrl]);

  if (imageUrl && !isTransitioning) {
    return <img src={imageUrl} alt={card.name} className="CardImage-raster" />;
  }

  return (
    <>
      {/* Visible immediately: the live, fully-styled component, while the
          rasterized version is still being captured — or, during the
          brief crossfade window, still visible underneath the overlay
          below until that fade finishes. */}
      <Card card={card} />

      {imageUrl && isTransitioning && (
        <motion.img
          src={imageUrl}
          alt={card.name}
          className="CardImage-raster CardImage-raster--overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15, ease: 'easeInOut' }}
          onAnimationComplete={() => setIsTransitioning(false)}
        />
      )}

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
