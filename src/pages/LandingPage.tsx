import NavMenu from '../components/NavMenu/NavMenu';
import { useAuth } from '../auth/AuthContext';

function LandingPage() {
  const { logOut } = useAuth();

  return (
    <NavMenu
      items={[
        { label: 'Duel', to: '/duel' },
        { label: 'Deck Builder', to: '/deck-builder' },
        { label: 'Account', to: '/account' },
        { label: 'Log Out', onClick: () => logOut() },
      ]}
    />
  );
}

export default LandingPage;