import type { CardData } from '../../types/Card';
import Card from './Card';
import { getCardImageUrl } from './cardImages';
import './CardImage.css';

interface CardImageProps {
  card: CardData;
}

// Renders the same visual result as <Card card={card} />, but from a
// pre-rasterized PNG (see scripts/rasterize-cards.js) when one exists for
// this card, filling the same 813x1185 box either way — callers don't
// need to know or care which is actually showing.
//
// Cards used to be rasterized on demand, in-browser, the first time each
// one was seen (see the project's git history for CardPrewarmGate/
// useRasterizedCard/rasterCache, all now removed) — that meant slower
// initial loads as the card pool grew, plus visible re-rasterizing after
// a refresh or reconnect mid-duel, since that cache lived only in memory
// for the current session. Rasterizing once, locally, ahead of time and
// shipping the results as ordinary bundled assets removes both: this is
// now just a synchronous lookup, no async capture/cache/warm-up gate
// needed anywhere in the running app.
function CardImage({ card }: CardImageProps) {
  const imageUrl = getCardImageUrl(card.id);

  if (imageUrl) {
    return <img src={imageUrl} alt={card.name} className="CardImage-raster" />;
  }

  // Falls back to the live, fully-styled component for any card that
  // hasn't been rasterized yet — e.g. just added to carddata.json, with
  // `npm run cards:rasterize` not re-run since — so local development
  // isn't blocked on remembering to run the script before a new card is
  // usable at all.
  return <Card card={card} />;
}

export default CardImage;
