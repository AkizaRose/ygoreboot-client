interface CategoryCounterProps {
  icon: string;
  count: number;
  label: string;
}

// Icon + number overlaid on top of it — no visible text label, "label" is
// only used for the icon's alt text (accessibility/screen readers).
function CategoryCounter({ icon, count, label }: CategoryCounterProps) {
  return (
    <div className="CategoryCounter">
      <img className="CategoryCounter-icon" src={icon} alt={label} />
      <span className="CategoryCounter-value">{count}</span>
    </div>
  );
}

export default CategoryCounter;
