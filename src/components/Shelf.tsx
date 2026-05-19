import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export type ShelfItem = {
  href: string;
  label: string;
  meta?: string;
  active?: boolean;
};

type ShelfProps = {
  title: string;
  items: ShelfItem[];
};

export function Shelf({ title, items }: ShelfProps) {
  const shelfId = `shelf-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  function scrollShelf(direction: -1 | 1) {
    const element = document.getElementById(shelfId);
    element?.scrollBy({
      left: direction * Math.max(280, element.clientWidth * 0.72),
      behavior: 'smooth',
    });
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="shelf" aria-labelledby={`${shelfId}-title`}>
      <div className="shelf__header">
        <h2 id={`${shelfId}-title`}>{title}</h2>
        <div className="shelf__controls">
          <button type="button" title={`Scroll ${title} left`} onClick={() => scrollShelf(-1)}>
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <button type="button" title={`Scroll ${title} right`} onClick={() => scrollShelf(1)}>
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>
      </div>
      <div className="shelf__track" id={shelfId}>
        {items.map((item) => (
          <Link
            className={item.active ? 'shelf__item shelf__item--active' : 'shelf__item'}
            to={item.href}
            key={item.href}
          >
            <span>{item.label}</span>
            {item.meta ? <small>{item.meta}</small> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}

