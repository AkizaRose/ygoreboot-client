import CardBrowser from './components/CardBrowser/CardBrowser';
import cardData from './data/carddata.json';
import type { CardData } from './types/Card';

function App() {
  const cards = cardData as CardData[];

  return <CardBrowser cards={cards} />;
}

export default App;
