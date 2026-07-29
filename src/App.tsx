import Card from './components/CardView/Card';
import cardData from './data/carddata.json';
import type { CardData } from './types/Card';

function App() {
  const cards = cardData as CardData[];

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '24px',
        padding: '24px',
      }}
    >
      {cards.map((card) => (
        <Card key={card.id} card={card} />
      ))}
    </div>
  );
}

export default App;
