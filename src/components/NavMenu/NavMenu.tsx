import { Link } from 'react-router-dom';
import './NavMenu.css';

export interface NavMenuItem {
  label: string;
  // Provide `to` for simple navigation (renders as a <Link>), or `onClick`
  // for anything else (e.g. Exit calling useNavigate() itself). If
  // neither is given, the item renders as a disabled placeholder button —
  // visibly present but inert, for features not built yet.
  to?: string;
  onClick?: () => void;
}

interface NavMenuProps {
  items: NavMenuItem[];
}

function NavMenu({ items }: NavMenuProps) {
  return (
    <div className="NavMenu">
      <nav className="NavMenu-nav">
        {items.map((item) => {
          if (item.to) {
            return (
              <Link key={item.label} to={item.to} className="NavMenu-button">
                {item.label}
              </Link>
            );
          }
          if (item.onClick) {
            return (
              <button
                key={item.label}
                type="button"
                className="NavMenu-button"
                onClick={item.onClick}
              >
                {item.label}
              </button>
            );
          }
          return (
            <button key={item.label} type="button" className="NavMenu-button" disabled>
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default NavMenu;
