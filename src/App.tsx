import CardBrowser from './components/CardBrowser/CardBrowser';
import cardData from './data/carddata.json';
import type { CardData } from './types/Card';
import './App.css';

function App() {
  const cards = cardData as CardData[];

  return (
    <div className="PageContent">
      <CardBrowser cards={cards} />
    </div>
  );
}

export default App;
