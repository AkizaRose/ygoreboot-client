import NavMenu from '../components/NavMenu/NavMenu';

function LandingPage() {
  return (
    <NavMenu
      items={[
        { label: 'Duel', to: '/duel' },
        { label: 'Deck Builder', to: '/deck-builder' },
      ]}
    />
  );
}

export default LandingPage;
